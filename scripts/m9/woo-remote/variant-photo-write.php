<?php
// Conditional writer loaded only by the origin-pinned test plugin.
// Only the two reviewed families; no general media/product API.
if (!defined('ABSPATH') || !m9_remote_test_origin()) { return; }
function m9_variant_photo_write_scope($id) {
    $scopes=[
        '97c82026-b3cc-4c60-8f22-13d7c00fb33a'=>['codes'=>['10581','10582','10583','10584','10585'],'sha'=>'a4d55159c147562de6d990134c1f9259d96be3a3a107c748d362d7db7b6f0c25'],
        'ba239bba-7691-43cc-9c76-8768a1af9f21'=>['codes'=>['10315','10316','10317','10324','10325'],'sha'=>'812a400b0264f59b6eb90a04d98f2a1c9c3ceb269312076480b4a9daf0438ec5'],
    ];
    return $scopes[$id]??null;
}
function m9_variant_photo_write_packet($p) {
    $keys=['protocol','update_id','parent_id','expected_revision','gallery_revision','assignments'];
    $uuid='/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/';
    if (!is_array($p) || count($p)!==count($keys) || array_diff(array_keys($p),$keys)
        || ($p['protocol']??null)!=='m9-remote-variant-photo-write-1'
        || !is_string($p['update_id']) || !preg_match($uuid,$p['update_id'])
        || !is_string($p['parent_id']) || !m9_variant_photo_write_scope($p['parent_id'])
        || !is_string($p['expected_revision']) || !preg_match('/^[a-f0-9]{64}$/',$p['expected_revision'])
        || !is_string($p['gallery_revision']) || !preg_match('/^[a-f0-9]{64}$/',$p['gallery_revision'])
        || !is_array($p['assignments']) || array_keys($p['assignments'])!==range(0,4)) { return false; }
    $seen=[];$scope=m9_variant_photo_write_scope($p['parent_id']);
    foreach ($p['assignments'] as $a) {
        if (!is_array($a) || count($a)!==6 || array_diff(array_keys($a),['variant_id','barcode','woo_variant_id','image_id','sha256','alt'])
            || !is_string($a['variant_id']) || !preg_match($uuid,$a['variant_id'])
            || !is_string($a['barcode']) || !in_array($a['barcode'],$scope['codes'],true) || isset($seen[$a['barcode']])
            || !is_int($a['woo_variant_id']) || $a['woo_variant_id']<1 || !is_int($a['image_id']) || $a['image_id']<0) { return false; }
        $seen[$a['barcode']]=true;
        // The no-source-photo size must remain empty. The other nine may only
        // reuse the exact original bytes and alt verified in the source cut.
        if ($a['barcode']==='10324') {
            if ($a['image_id']!==0 || $a['sha256']!==null || $a['alt']!==null) { return false; }
        } elseif ($a['image_id']<1 || $a['sha256']!==$scope['sha'] || $a['alt']!=='') { return false; }
    }
    return count($seen)===5 && count(array_unique(array_column($p['assignments'],'variant_id')))===5
        && count(array_unique(array_column($p['assignments'],'woo_variant_id')))===5;
}
function m9_variant_photo_after($before,$p) {
    if (!isset($before['variants'],$before['images']) || count($before['variants'])!==5) { return false; }
    $after=$before;unset($after['revision']);
    foreach ($after['variants'] as &$v) {
        $matches=array_values(array_filter($p['assignments'],fn($a)=>$a['variant_id']===$v['variant_id'] && $a['barcode']===$v['barcode'] && $a['woo_variant_id']===$v['woo_variant_id']));
        if (count($matches)!==1) { return false; }$a=$matches[0];
        if ($v['own_image_id']!==0 && $v['own_image_id']!==$a['image_id']) { return false; }
        if ($a['image_id']===0) {
            if ($v['own_image_id']!==0 || $v['own_image']!==null) { return false; }
            continue;
        }
        $photos=array_values(array_filter($before['images'],fn($i)=>$i['id']===$a['image_id'] && $i['sha256']===$a['sha256'] && $i['alt']===$a['alt']));
        // Same bytes under multiple attachment IDs remain ambiguous.
        $same=array_filter($before['images'],fn($i)=>$i['sha256']===$a['sha256'] && $i['alt']===$a['alt']);
        if (count($photos)!==1 || count($same)!==1) { return false; }
        $v['own_image_id']=$a['image_id'];$v['own_image']=['id'=>$a['image_id'],'sha256'=>$a['sha256'],'alt'=>$a['alt']];
    }unset($v);
    $after['revision']=hash('sha256',wp_json_encode($after));return $after;
}
function m9_variant_photo_lock($before) {
    global $wpdb;
    foreach ([$wpdb->posts,$wpdb->postmeta,$wpdb->options] as $table) {
        $engine=$wpdb->get_var($wpdb->prepare('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s',$table));
        if (strtoupper((string)$engine)!=='INNODB') { throw new Exception('TRANSACTION_REQUIRED'); }
    }
    if ($wpdb->query('START TRANSACTION')===false) { throw new Exception('START_FAILED'); }
    $ids=array_unique(array_merge([$before['woo_product_id']],array_column($before['variants'],'woo_variant_id'),array_column($before['images'],'id')));sort($ids,SORT_NUMERIC);
    foreach ($ids as $id) {
        if ($wpdb->query($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE ID=%d FOR UPDATE",$id))===false
            || $wpdb->query($wpdb->prepare("SELECT meta_id FROM {$wpdb->postmeta} WHERE post_id=%d FOR UPDATE",$id))===false) { throw new Exception('LOCK_FAILED'); }
        clean_post_cache($id);
    }
}
function m9_variant_photo_clear($before) {
    foreach (array_merge([$before['woo_product_id']],array_column($before['variants'],'woo_variant_id'),array_column($before['images'],'id')) as $id) { clean_post_cache($id); }
}
function m9_variant_photo_save_receipt($key,$entry) {
    global $wpdb;
    wp_cache_delete($key,'options');update_option($key,$entry,false);
    $raw=$wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s",$key));
    if ($raw===null || wp_json_encode(maybe_unserialize($raw))!==wp_json_encode($entry)) { throw new Exception('RECEIPT_WRITE_FAILED'); }
}
function m9_variant_photo_assignment_receipt($request) {
    global $wpdb;
    $id=$request['update_id']??'';
    if (!is_string($id) || !preg_match('/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/',$id)) { return new WP_Error('m9_invalid_photo_id','Solicitud inválida.',['status'=>400]); }
    $key='m9_variant_photo_assignment_'.$id;
    // Read directly: a persistent option cache must not conceal a receipt.
    $raw=$wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s",$key));
    $entry=$raw===null ? null : maybe_unserialize($raw);
    if (!$entry || $entry['owner']!==get_current_user_id()) { return new WP_Error('m9_photo_receipt_missing','Sin recibo.',['status'=>404]); }
    $live=m9_variant_photo_read(['id'=>$entry['packet']['parent_id']]);
    if (is_wp_error($live)) { return $live; }
    if ($entry['state']!=='APPLYING') { return $entry; }
    // An unknown HTTP/COMMIT result is reconciled with stored before-evidence,
    // never by dispatching thumbnail changes again.
    try {
        m9_variant_photo_lock($entry['before']);
        $locked=$wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s FOR UPDATE",$key));
        if ($locked===null) { throw new Exception('RECEIPT_MISSING'); }
        $entry=maybe_unserialize($locked);
        if ($entry['state']!=='APPLYING') {
            if ($wpdb->query('COMMIT')===false) { throw new Exception('COMMIT_UNKNOWN'); }
            return $entry;
        }
        $live=m9_variant_photo_read(['id'=>$entry['packet']['parent_id']]);
        $after=m9_variant_photo_after($entry['before'],$entry['packet']);
        if (is_wp_error($live) || !$after || wp_json_encode($live)!==wp_json_encode($after)) { throw new Exception('RESULT_UNCONFIRMED'); }
        $entry['state']='SUCCEEDED';$entry['after_revision']=$live['revision'];$entry['reconciled_without_photo_write']=true;
        m9_variant_photo_save_receipt($key,$entry);
        if ($wpdb->query('COMMIT')===false) { throw new Exception('COMMIT_UNKNOWN'); }
        return $entry;
    } catch (Throwable $e) {
        $wpdb->query('ROLLBACK');wp_cache_delete($key,'options');
        return new WP_Error('m9_photo_result_unknown','Conservar revisión; no reenviar la asignación.',['status'=>409]);
    } finally { m9_variant_photo_clear($entry['before']); }
}
function m9_variant_photo_assign($request) {
    global $wpdb;
    $p=$request->get_json_params();
    if (!m9_variant_photo_write_packet($p)) { return new WP_Error('m9_photo_packet','Paquete fuera del piloto verificado.',['status'=>400]); }
    $key='m9_variant_photo_assignment_'.$p['update_id'];$fingerprint=hash('sha256',wp_json_encode($p));
    $prior=m9_variant_photo_assignment_receipt(['update_id'=>$p['update_id']]);
    if (!is_wp_error($prior)) {
        if ($prior['fingerprint']!==$fingerprint) { return new WP_Error('m9_photo_request_changed','Solicitud diferente.',['status'=>409]); }
        return $prior;
    }
    if ($prior->get_error_code()!=='m9_photo_receipt_missing') { return $prior; }
    $before=m9_variant_photo_read(['id'=>$p['parent_id']]);
    if (is_wp_error($before)) { return $before; }
    $after=m9_variant_photo_after($before,$p);
    if ($before['revision']!==$p['expected_revision'] || $before['gallery_revision']!==$p['gallery_revision'] || !$after) { return new WP_Error('m9_photo_context_changed','Evidencia cambiada; revisar.',['status'=>409]); }
    $entry=['protocol'=>$p['protocol'],'owner'=>get_current_user_id(),'fingerprint'=>$fingerprint,'state'=>'APPLYING','packet'=>$p,'before'=>$before];
    // Atomic request reservation before any metadata mutation. No automatic
    // expiry or overwrite of an uncertain reservation.
    if (!add_option($key,$entry,'',false)) { return new WP_Error('m9_photo_busy','Consulte el recibo.',['status'=>409]); }
    $commit_attempted=false;
    try {
        m9_variant_photo_lock($before);
        $locked=$wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s FOR UPDATE",$key));
        if ($locked===null || maybe_unserialize($locked)['fingerprint']!==$fingerprint) { throw new Exception('RECEIPT_CHANGED'); }
        $live=m9_variant_photo_read(['id'=>$p['parent_id']]);
        if (is_wp_error($live) || wp_json_encode($live)!==wp_json_encode($before)) { throw new Exception('CONTEXT_CHANGED'); }
        foreach ($p['assignments'] as $a) {
            if ($a['image_id']===0) { continue; }
            $v=array_values(array_filter($before['variants'],fn($v)=>$v['variant_id']===$a['variant_id']))[0];
            if ($v['own_image_id']===0) { update_post_meta($a['woo_variant_id'],'_thumbnail_id',$a['image_id']); }
        }
        m9_variant_photo_clear($before);
        $verified=m9_variant_photo_read(['id'=>$p['parent_id']]);
        if (is_wp_error($verified) || wp_json_encode($verified)!==wp_json_encode($after)) { throw new Exception('READBACK_FAILED'); }
        $entry['state']='SUCCEEDED';$entry['after_revision']=$verified['revision'];
        m9_variant_photo_save_receipt($key,$entry);
        $commit_attempted=true;
        if ($wpdb->query('COMMIT')===false) { throw new Exception('COMMIT_UNKNOWN'); }
        return $entry;
    } catch (Throwable $e) {
        $wpdb->query('ROLLBACK');wp_cache_delete($key,'options');
        // A failed COMMIT may have succeeded. Leave its persisted APPLYING or
        // SUCCEEDED receipt untouched, for read-only photo reconciliation.
        if (!$commit_attempted) { $entry['state']='REVIEW_REQUIRED';update_option($key,$entry,false); }
        return new WP_Error('m9_photo_review','Consulte el recibo; no repita la asignación.',['status'=>409]);
    } finally { m9_variant_photo_clear($before); }
}
add_action('rest_api_init',function(){
    register_rest_route('m9-test/v1','/variant-photo-assignments',['methods'=>'POST','permission_callback'=>'m9_bridge_permission','callback'=>'m9_variant_photo_assign']);
    register_rest_route('m9-test/v1','/variant-photo-assignments/(?P<update_id>[a-f0-9-]{36})',['methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_variant_photo_assignment_receipt']);
});
