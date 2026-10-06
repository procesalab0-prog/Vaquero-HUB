<?php
// Dedicated test-only gallery writes. No general product/media API is exposed.
if (!defined('ABSPATH') || !m9_remote_test_origin()) { return; }
function m9_gallery_signature($images) {
    return array_map(function ($i) { return array('sha256'=>$i['sha256'],'alt'=>$i['alt']); }, $images);
}
function m9_gallery_update_receipt($request) {
    $entry=get_option('m9_gallery_update_'.strtolower($request['update_id']));
    if (!$entry || $entry['owner']!==get_current_user_id()) { return new WP_Error('m9_not_found','Sin recibo.',array('status'=>404)); }
    if ($entry['state']==='APPLYING') {
        $live=m9_bridge_gallery(array('id'=>$entry['parent_id']));
        if (!is_wp_error($live) && m9_gallery_signature($live['images'])===$entry['images']) {
            $entry['state']='SUCCEEDED'; $entry['gallery']=$live;
            update_option('m9_gallery_update_'.$entry['update_id'],$entry,false);
        }
    }
    return $entry;
}
function m9_gallery_update($request) {
    global $wpdb;
    $p=$request->get_json_params();
    $keys=array('update_id','parent_id','expected_revision','images');
    if (!is_array($p) || count($p)!==4 || array_diff(array_keys($p),$keys) ||
        !is_string($p['update_id']) || !is_string($p['parent_id']) ||
        !preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/',$p['update_id']) ||
        !preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/',$p['parent_id']) ||
        !is_string($p['expected_revision']) || !preg_match('/^[a-f0-9]{64}$/',$p['expected_revision']) ||
        !is_array($p['images']) || count($p['images'])<1 || count($p['images'])>20) {
        return new WP_Error('m9_invalid_gallery','Galería inválida.',array('status'=>400));
    }
    $decoded=array(); $total=0; $seen=array();
    foreach ($p['images'] as $image) {
        if (!is_array($image) || count($image)!==3 || !isset($image['base64'],$image['sha256'],$image['alt']) ||
            !is_string($image['base64']) || strlen($image['base64'])>5592408 || !is_string($image['sha256']) ||
            !is_string($image['alt']) || mb_strlen($image['alt'])>500 || sanitize_text_field($image['alt'])!==$image['alt']) {
            return new WP_Error('m9_invalid_gallery','Imagen inválida.',array('status'=>400));
        }
        $bytes=base64_decode($image['base64'],true); $size=$bytes===false ? false : @getimagesizefromstring($bytes);
        if ($bytes===false || strlen($bytes)>4194304 || base64_encode($bytes)!==$image['base64'] ||
            hash('sha256',$bytes)!==$image['sha256'] || isset($seen[$image['sha256']]) || !$size ||
            !in_array($size['mime'],array('image/jpeg','image/png','image/webp'),true) || $size[0]*$size[1]>25000000) {
            return new WP_Error('m9_invalid_gallery','Contenido de foto inválido.',array('status'=>400));
        }
        $total+=strlen($bytes); if ($total>16777216) { return new WP_Error('m9_gallery_limit','Galería demasiado grande.',array('status'=>400)); }
        $seen[$image['sha256']]=true; $decoded[]=array($bytes,$size['mime']);
    }
    $isolation=m9_bridge_isolation();
    if (!$isolation['mail_blocked'] || !$isolation['outbound_blocked'] || !$isolation['purchase_blocked'] || !$isolation['orders_blocked'] || $isolation['payment_gateways']!==0) {
        return new WP_Error('m9_isolation_failed','Aislamiento requerido.',array('status'=>403));
    }
    $gallery=m9_bridge_gallery(array('id'=>$p['parent_id']));
    if (is_wp_error($gallery)) { return $gallery; }
    $key='m9_gallery_update_'.$p['update_id']; $hash=hash('sha256',wp_json_encode($p)); $prior=get_option($key);
    if ($prior) {
        if ($prior['owner']!==get_current_user_id() || $prior['fingerprint']!==$hash) { return new WP_Error('m9_update_conflict','Solicitud diferente.',array('status'=>409)); }
        return m9_gallery_update_receipt(array('update_id'=>$p['update_id']));
    }
    if ($gallery['revision']!==$p['expected_revision']) { return new WP_Error('m9_gallery_changed','La galería cambió.',array('status'=>409)); }
    foreach ($gallery['images'] as $old) {
        if (!isset($seen[$old['sha256']])) { return new WP_Error('m9_gallery_removal','Retirada de fotos requiere revisión.',array('status'=>409)); }
    }
    // Transactions are required. Refuse hosts with nontransactional WP tables.
    foreach (array($wpdb->posts,$wpdb->postmeta,$wpdb->options) as $table) {
        $engine=$wpdb->get_var($wpdb->prepare('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s',$table));
        if (strtoupper((string)$engine)!=='INNODB') { return new WP_Error('m9_transaction_required','Tablas transaccionales requeridas.',array('status'=>409)); }
    }
    $entry=array('owner'=>get_current_user_id(),'update_id'=>$p['update_id'],'parent_id'=>$p['parent_id'],'fingerprint'=>$hash,'state'=>'PREPARING','images'=>m9_gallery_signature($p['images']));
    if (!add_option($key,$entry,'',false)) { return new WP_Error('m9_update_busy','Consulte el recibo.',array('status'=>409)); }
    $transaction=false; $ids=array();
    try {
        require_once ABSPATH.'wp-admin/includes/file.php'; require_once ABSPATH.'wp-admin/includes/media.php'; require_once ABSPATH.'wp-admin/includes/image.php';
        foreach ($p['images'] as $n=>$image) {
            $reuse=0;
            foreach ($gallery['images'] as $old) { if ($old['sha256']===$image['sha256'] && $old['alt']===$image['alt']) { $reuse=$old['id']; break; } }
            if ($reuse) { $ids[]=$reuse; continue; }
            // Never edit shared attachment metadata: changed alt gets a separate test copy.
            list($bytes,$mime)=$decoded[$n]; $ext=array('image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp')[$mime];
            $tmp=wp_tempnam('m9-gallery');
            if (!$tmp || file_put_contents($tmp,$bytes)!==strlen($bytes)) { throw new Exception('PHOTO_WRITE_FAILED'); }
            try { $id=media_handle_sideload(array('name'=>'m9-'.$p['update_id'].'-'.$n.'.'.$ext,'tmp_name'=>$tmp,'error'=>0,'size'=>strlen($bytes)),$gallery['woo_product_id']); }
            finally { if (is_file($tmp)) { unlink($tmp); } }
            if (is_wp_error($id)) { throw new Exception('PHOTO_SAVE_FAILED'); }
            update_post_meta($id,'_wp_attachment_image_alt',$image['alt']);
            if (hash_file('sha256',wp_get_original_image_path($id))!==$image['sha256']) { throw new Exception('PHOTO_READBACK_FAILED'); }
            $ids[]=(int)$id;
            $entry['prepared_ids']=$ids; update_option($key,$entry,false);
        }
        $entry['state']='APPLYING'; update_option($key,$entry,false);
        if ($wpdb->query('START TRANSACTION')===false) { throw new Exception('TRANSACTION_FAILED'); } $transaction=true;
        $lock_ids=array_unique(array_merge(array($gallery['woo_product_id']),array_column($gallery['images'],'id'),$ids)); sort($lock_ids,SORT_NUMERIC);
        foreach ($lock_ids as $id) {
            if ($wpdb->query($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE ID=%d FOR UPDATE",$id))===false ||
                $wpdb->query($wpdb->prepare("SELECT meta_id FROM {$wpdb->postmeta} WHERE post_id=%d FOR UPDATE",$id))===false) { throw new Exception('LOCK_FAILED'); }
            clean_post_cache($id);
        }
        $latest=m9_bridge_gallery(array('id'=>$p['parent_id']));
        if (is_wp_error($latest) || $latest['revision']!==$p['expected_revision']) { throw new Exception('GALLERY_CHANGED'); }
        // Only two product metadata fields change; no price, identity, status or stock writes.
        update_post_meta($gallery['woo_product_id'],'_thumbnail_id',$ids[0]);
        update_post_meta($gallery['woo_product_id'],'_product_image_gallery',implode(',',array_slice($ids,1)));
        clean_post_cache($gallery['woo_product_id']);
        $verified=m9_bridge_gallery(array('id'=>$p['parent_id']));
        if (is_wp_error($verified) || m9_gallery_signature($verified['images'])!==$entry['images']) { throw new Exception('GALLERY_READBACK_FAILED'); }
        if ($wpdb->query('COMMIT')===false) { throw new Exception('COMMIT_UNKNOWN'); } $transaction=false;
        $entry['state']='SUCCEEDED'; $entry['gallery']=$verified; update_option($key,$entry,false);
        return $entry;
    } catch (Throwable $e) {
        if ($transaction) { $wpdb->query('ROLLBACK'); }
        clean_post_cache($gallery['woo_product_id']);
        $entry['state']='REVIEW_REQUIRED'; $entry['reason']='GALLERY_UPDATE_REVIEW'; update_option($key,$entry,false);
        return new WP_Error('m9_gallery_review','Consulte el recibo; no repita la carga.',array('status'=>409));
    }
}
add_action('rest_api_init',function(){
    register_rest_route('m9-test/v1','/gallery-updates',array('methods'=>'POST','permission_callback'=>'m9_bridge_permission','callback'=>'m9_gallery_update'));
    register_rest_route('m9-test/v1','/gallery-updates/(?P<update_id>[0-9a-f-]{36})',array('methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_gallery_update_receipt'));
});
