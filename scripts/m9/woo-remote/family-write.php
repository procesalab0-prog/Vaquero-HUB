<?php
// Dedicated variable-family creation; no generic Woo writes or stock fields.
if (!defined('ABSPATH') || !m9_remote_test_origin()) { return; }
function m9_family_validate($p) {
    $keys=['protocol','request_id','product_id','revision','name','description','short_description','barcode','variants','categories','images','descriptive_attributes'];
    if (!is_array($p) || count($p)!==count($keys) || array_diff(array_keys($p),$keys) || ($p['protocol']??'')!=='m9-remote-family-1' || $p['barcode']!=='M9-P-'.$p['product_id']) { throw new Exception('INVALID_FAMILY_FIELDS'); }
    if (!is_array($p['images']) || count($p['images'])<1 || count($p['images'])>20) { throw new Exception('INVALID_IMAGES'); }
    $total=0;$hashes=[];$decoded=[];
    foreach($p['images'] as $image) {
        if(!is_array($image) || count($image)!==3 || !isset($image['alt'],$image['base64'],$image['sha256']) || !is_string($image['alt']) || mb_strlen($image['alt'])>240 || sanitize_text_field($image['alt'])!==$image['alt']) { throw new Exception('INVALID_IMAGE_ALT'); }
        $base=array_intersect_key($p,array_flip(['request_id','product_id','revision','name','description','short_description','barcode']));
        $base['protocol']='m9-remote-draft-1';$base['price_cents']=0;$base['image']=['base64'=>$image['base64'],'sha256'=>$image['sha256']];
        $decoded[]=m9_bridge_validate($base);$total+=strlen(end($decoded)[0]);$hashes[]=$image['sha256'];
    }
    if($total>16777216 || count(array_unique($hashes))!==count($hashes)) { throw new Exception('GALLERY_LIMIT_OR_DUPLICATE'); }
    if(!is_array($p['variants']) || count($p['variants'])<2 || count($p['variants'])>100) { throw new Exception('INVALID_VARIANTS'); }
    $ids=[];$codes=[];$combinations=[];$shape=null;
    foreach($p['variants'] as $v) {
        if(!is_array($v) || count($v)!==4 || array_diff(array_keys($v),['variant_id','barcode','price_cents','attributes']) || !is_string($v['variant_id']) || !preg_match('/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/',$v['variant_id']) ||
            !is_string($v['barcode']) || trim($v['barcode'])==='' || strlen($v['barcode'])>100 || sanitize_text_field($v['barcode'])!==$v['barcode'] || $v['barcode']===$p['barcode'] || !is_int($v['price_cents']) || $v['price_cents']<0 || $v['price_cents']>100000000) { throw new Exception('INVALID_VARIANT'); }
        if(!is_array($v['attributes']) || count($v['attributes'])<1 || count($v['attributes'])>3) { throw new Exception('INVALID_ATTRIBUTES'); }
        $a=$v['attributes'];ksort($a);
        foreach($a as $k=>$value) if(!in_array($k,['TALLA','COLOR','LARGO'],true) || !is_string($value) || trim($value)==='' || mb_strlen($value)>100 || sanitize_text_field($value)!==$value) { throw new Exception('INVALID_ATTRIBUTES'); }
        if($shape!==null && $shape!==array_keys($a)) { throw new Exception('ATTRIBUTE_KEYS_DIFFER'); } $shape=array_keys($a);
        $ids[]=$v['variant_id'];$codes[]=$v['barcode'];$combinations[]=wp_json_encode($a);
    }
    foreach([$ids,$codes,$combinations] as $values) if(count(array_unique($values))!==count($values)) { throw new Exception('DUPLICATE_VARIANT'); }
    if(!is_array($p['categories']) || count($p['categories'])>20 || count(array_unique($p['categories']))!==count($p['categories'])) { throw new Exception('INVALID_CATEGORIES'); }
    foreach($p['categories'] as $path) {
        if(!is_string($path) || strlen($path)>240) { throw new Exception('INVALID_CATEGORY'); }
        foreach(explode(' > ',$path) as $name) if(trim($name)==='' || sanitize_text_field($name)!==$name) { throw new Exception('INVALID_CATEGORY'); }
    }
    if(!is_array($p['descriptive_attributes']) || count($p['descriptive_attributes'])>10) { throw new Exception('INVALID_DESCRIPTIVE_ATTRIBUTES'); }
    $names=array_map('strtolower',$shape);
    foreach($p['descriptive_attributes'] as $a) {
        if(!is_array($a) || count($a)!==3 || array_diff(array_keys($a),['name','option','variation']) || $a['variation']!==false || !is_string($a['name']) || trim($a['name'])==='' || !is_string($a['option']) || trim($a['option'])==='' || strlen($a['option'])>1000 || sanitize_text_field($a['name'])!==$a['name'] || sanitize_text_field($a['option'])!==$a['option'] || in_array(strtolower($a['name']),$names,true)) { throw new Exception('INVALID_DESCRIPTIVE_ATTRIBUTES'); }
        $names[]=strtolower($a['name']);
    }
    return $decoded;
}
function m9_family_category($path) {
    $parent=0;
    foreach(explode(' > ',$path) as $name) {
        // A deterministic per-path slug prevents a like-named leaf elsewhere
        // from being mistaken for this category. Existing exact names are reused.
        $terms=get_terms(['taxonomy'=>'product_cat','hide_empty'=>false,'parent'=>$parent,'name'=>$name]);
        if(is_wp_error($terms) || count($terms)>1) { throw new Exception('CATEGORY_AMBIGUOUS'); }
        if(count($terms)===1) {
            if($terms[0]->name!==$name) { throw new Exception('CATEGORY_NAME_CHANGED'); }
            $parent=(int)$terms[0]->term_id;continue;
        }
        $created=wp_insert_term($name,'product_cat',['parent'=>$parent,'slug'=>'m9-'.substr(hash('sha256',$parent.'|'.$name),0,32)]);
        if(is_wp_error($created)) { throw new Exception('CATEGORY_CREATE_REVIEW'); }
        $term=get_term((int)$created['term_id'],'product_cat');
        if(is_wp_error($term) || !$term || $term->name!==$name || (int)$term->parent!==$parent) { throw new Exception('CATEGORY_READBACK'); }
        $parent=(int)$term->term_id;
    }
    return $parent;
}
function m9_family_category_path($id,$seen=[]) {
    if(in_array($id,$seen,true)) { return null; }$seen[]=$id;
    $t=get_term($id,'product_cat');if(!$t || is_wp_error($t)) { return null; }
    if(!$t->parent) { return $t->name; }
    $prefix=m9_family_category_path((int)$t->parent,$seen);
    return $prefix===null ? null : $prefix.' > '.$t->name;
}
function m9_family_identity($entry) {
    $p=wc_get_product((int)$entry['remote_product_id']);
    if(!$p || !$p->is_type('variable') || $p->get_status()!=='draft' || $p->is_purchasable() || $p->get_meta('_mi_tienda_product_id')!==$entry['product_id'] || $p->get_meta('_m9_remote_request')!==$entry['request_id']) { return false; }
    $actual=get_posts(['post_type'=>'product_variation','post_parent'=>$p->get_id(),'post_status'=>['draft','publish','private','pending','future','trash','inherit'],'numberposts'=>-1,'fields'=>'ids']);
    $expected=array_map('intval',array_column($entry['verified']['variants'],'remote_variation_id'));
    sort($actual);sort($expected);if($actual!==$expected) { return false; }
    foreach($entry['verified']['variants'] as $v) {
        $child=wc_get_product($v['remote_variation_id']);$attributes=[];
        foreach($v['attributes'] as $key=>$val) { $attributes[strtolower($key)]=$val; }ksort($attributes);
        $got=$child ? $child->get_attributes('edit') : [];ksort($got);
        if(!$child || $child->get_status()!=='draft' || (int)$child->get_parent_id()!==(int)$p->get_id() || $child->get_sku('edit')!==$v['barcode'] || $child->get_meta('_mi_tienda_barcode')!==$v['barcode'] || $child->get_meta('_mi_tienda_variant_id')!==$v['variant_id'] || $child->get_meta('_m9_remote_request')!==$entry['request_id'] || $got!==$attributes || $child->is_purchasable()) { return false; }
    }
    return true;
}
function m9_family_create($request) {
    $p=$request->get_json_params();
    try { $decoded=m9_family_validate($p); } catch(Throwable $e) { return new WP_Error('m9_invalid_family',$e->getMessage(),['status'=>400]); }
    $guard=m9_bridge_isolation();
    if(!$guard['mail_blocked'] || !$guard['outbound_blocked'] || !$guard['purchase_blocked'] || !$guard['orders_blocked'] || $guard['payment_gateways']!==0) { return new WP_Error('m9_isolation_failed','Aislamiento requerido.',['status'=>403]); }
    $key='m9_remote_job_'.$p['request_id'];$fingerprint=hash('sha256',wp_json_encode($p));$old=get_option($key);
    if($old) {
        if($old['owner']!==get_current_user_id() || $old['fingerprint']!==$fingerprint) { return new WP_Error('m9_family_conflict','Solicitud distinta.',['status'=>409]); }
        return $old; // No second write, including partial or uncertain outcomes.
    }
    $entry=['protocol'=>'m9-remote-family-1','owner'=>get_current_user_id(),'request_id'=>$p['request_id'],'product_id'=>$p['product_id'],'revision'=>$p['revision'],'fingerprint'=>$fingerprint,'state'=>'DISPATCHING','remote_variation_ids'=>[],'remote_image_ids'=>[]];
    if(!add_option($key,$entry,'',false)) { return new WP_Error('m9_job_locked','Consulte recibo.',['status'=>409]); }
    if(!add_option('m9_remote_product_'.$p['product_id'],$p['request_id'],'',false)) { $entry['state']='REVIEW_REQUIRED';update_option($key,$entry,false);return new WP_Error('m9_product_exists','Identidad ya enviada.',['status'=>409]); }
    try {
        foreach(array_merge([$p['barcode']],array_column($p['variants'],'barcode')) as $code) if(wc_get_product_id_by_sku($code)) { throw new Exception('DUPLICATE_BARCODE'); }
        $category_ids=array_map('m9_family_category',$p['categories']);
        $product=new WC_Product_Variable();$product->set_status('draft');$product->set_name($p['name']);$product->set_description($p['description']);$product->set_short_description($p['short_description']);$product->set_sku($p['barcode']);$product->set_category_ids($category_ids);
        $product->update_meta_data('_mi_tienda_product_id',$p['product_id']);$product->update_meta_data('_mi_tienda_barcode',$p['barcode']);$product->update_meta_data('_m9_remote_request',$p['request_id']);$product->update_meta_data('_m9_test_only','yes');
        $attributes=[];
        foreach(array_keys($p['variants'][0]['attributes']) as $attribute_name) {
            $a=new WC_Product_Attribute();$a->set_name($attribute_name);$a->set_options(array_values(array_unique(array_map(fn($v)=>$v['attributes'][$attribute_name],$p['variants']))));$a->set_visible(true);$a->set_variation(true);$attributes[]=$a;
        }
        foreach($p['descriptive_attributes'] as $attr) { $a=new WC_Product_Attribute();$a->set_name($attr['name']);$a->set_options([$attr['option']]);$a->set_visible(true);$a->set_variation(false);$attributes[]=$a; }
        $product->set_attributes($attributes);$id=$product->save();if(!$id) { throw new Exception('PARENT_SAVE_FAILED'); }
        $entry['remote_product_id']=(int)$id;update_option($key,$entry,false);$verified_variants=[];
        foreach($p['variants'] as $v) {
            $child=new WC_Product_Variation();$child->set_parent_id($id);$child->set_status('draft');$child->set_sku($v['barcode']);$child->set_regular_price(number_format($v['price_cents']/100,2,'.',''));$child->set_attributes(array_change_key_case($v['attributes'],CASE_LOWER));
            $child->update_meta_data('_mi_tienda_variant_id',$v['variant_id']);$child->update_meta_data('_mi_tienda_barcode',$v['barcode']);$child->update_meta_data('_m9_remote_request',$p['request_id']);$child->update_meta_data('_m9_test_only','yes');
            $child_id=$child->save();if(!$child_id) { throw new Exception('VARIANT_SAVE_FAILED'); }
            $entry['remote_variation_ids'][]=(int)$child_id;update_option($key,$entry,false);
            $verified_variants[]=array_merge($v,['remote_variation_id'=>(int)$child_id]);
        }
        require_once ABSPATH.'wp-admin/includes/file.php';require_once ABSPATH.'wp-admin/includes/media.php';require_once ABSPATH.'wp-admin/includes/image.php';
        foreach($decoded as $i=>$data) {
            [$bytes,$mime]=$data;$tmp=wp_tempnam('m9-family');
            if(!$tmp || file_put_contents($tmp,$bytes)!==strlen($bytes)) { throw new Exception('IMAGE_WRITE_FAILED'); }
            try { $media=media_handle_sideload(['name'=>'m9-'.$p['request_id'].'-'.$i.'.'.['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'][$mime],'tmp_name'=>$tmp,'error'=>0,'size'=>strlen($bytes)],$id); }
            finally { if(is_file($tmp)) { unlink($tmp); } }
            if(is_wp_error($media)) { throw new Exception('IMAGE_SAVE_FAILED'); }
            $entry['remote_image_ids'][]=(int)$media;update_option($key,$entry,false);update_post_meta($media,'_wp_attachment_image_alt',$p['images'][$i]['alt']);
        }
        $product->set_image_id($entry['remote_image_ids'][0]);$product->set_gallery_image_ids(array_slice($entry['remote_image_ids'],1));$product->save();
        $entry['verified']=['barcode'=>$p['barcode'],'variants'=>$verified_variants];
        if(!m9_family_identity($entry)) { throw new Exception('FAMILY_IDENTITY_READBACK'); }
        $check=wc_get_product($id);
        if($check->get_name('edit')!==$p['name'] || $check->get_description('edit')!==$p['description'] || $check->get_short_description('edit')!==$p['short_description'] || $check->get_sku('edit')!==$p['barcode']) { throw new Exception('CONTENT_READBACK'); }
        foreach($verified_variants as $v) if((int)round((float)wc_get_product($v['remote_variation_id'])->get_regular_price('edit')*100)!==$v['price_cents']) { throw new Exception('PRICE_READBACK'); }
        $paths=array_map('m9_family_category_path',$check->get_category_ids());$expected=$p['categories'];sort($paths);sort($expected);if($paths!==$expected) { throw new Exception('CATEGORY_READBACK'); }
        $ids=array_merge([(int)$check->get_image_id('edit')],array_map('intval',$check->get_gallery_image_ids('edit')));
        if($ids!==$entry['remote_image_ids']) { throw new Exception('IMAGE_ORDER_READBACK'); }
        $images=[];
        foreach($ids as $i=>$media) {
            $path=wp_get_original_image_path($media);$alt=(string)get_post_meta($media,'_wp_attachment_image_alt',true);
            if(!$path || !is_file($path) || hash_file('sha256',$path)!==$p['images'][$i]['sha256'] || $alt!==$p['images'][$i]['alt']) { throw new Exception('IMAGE_READBACK'); }
            $images[]=['sha256'=>$p['images'][$i]['sha256'],'alt'=>$alt];
        }
        // Read every parent attribute back, including non-variation color text.
        $actual_attrs=$check->get_attributes();if(count($actual_attrs)!==count($attributes)) { throw new Exception('PARENT_ATTRIBUTE_READBACK'); }
        foreach($attributes as $a) { $got=$actual_attrs[sanitize_title($a->get_name())]??null;if(!$got || $got->get_name()!==$a->get_name() || $got->get_options()!==$a->get_options() || $got->get_variation()!==$a->get_variation()) { throw new Exception('PARENT_ATTRIBUTE_READBACK'); } }
        $entry['verified']=array_merge($entry['verified'],['status'=>'draft','purchasable'=>false,'name'=>$check->get_name('edit'),'description'=>$check->get_description('edit'),'short_description'=>$check->get_short_description('edit'),'categories'=>$p['categories'],'descriptive_attributes'=>$p['descriptive_attributes'],'images'=>$images]);
        $entry['state']='SUCCEEDED';update_option($key,$entry,false);return $entry;
    } catch(Throwable $e) {
        $entry['state']='REVIEW_REQUIRED';$entry['error']=$e->getMessage();unset($entry['verified']);update_option($key,$entry,false);
        return new WP_Error('m9_family_review','Consulte el recibo; no cree otro producto.',['status'=>409]);
    }
}
add_action('rest_api_init',function(){register_rest_route('m9-test/v1','/families',['methods'=>'POST','permission_callback'=>'m9_bridge_permission','callback'=>'m9_family_create']);});

// Repair only the 1.3.0/1.3.1 misplaced family receipt. Never create assets.
// Runs in the authenticated administrator screen after the plugin update.
add_action('admin_init', function() {
    if (!current_user_can('manage_options') || !m9_remote_test_origin()) { return; }
    foreach (['TALLA','COLOR','LARGO'] as $legacy_key) {
        $saved=get_option($legacy_key);
        if (!is_array($saved) || ($saved['protocol']??'')!=='m9-remote-family-1' || ($saved['state']??'')!=='SUCCEEDED' || empty($saved['verified']) || !preg_match('/^[0-9a-f-]{36}$/', $saved['request_id']??'')) { continue; }
        $canonical='m9_remote_job_'.$saved['request_id'];$pending=get_option($canonical);
        if (!is_array($pending) || ($pending['state']??'')!=='DISPATCHING') { continue; }
        foreach (['protocol','owner','request_id','product_id','revision','fingerprint'] as $field) {
            if (!isset($saved[$field],$pending[$field]) || $saved[$field]!==$pending[$field]) { continue 2; }
        }
        if (get_option('m9_remote_product_'.$saved['product_id'])!==$saved['request_id'] || !m9_family_identity($saved)) { continue; }
        update_option($canonical,$saved,false);
    }
});
