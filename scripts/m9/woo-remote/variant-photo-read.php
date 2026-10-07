<?php
// Read-only own-photo preflight. This module never assigns or uploads images.
if (!defined('ABSPATH') || !m9_remote_test_origin()) { return; }
function m9_variant_photo_pilot($id) {
    return in_array($id, ['97c82026-b3cc-4c60-8f22-13d7c00fb33a','ba239bba-7691-43cc-9c76-8768a1af9f21'], true);
}
function m9_variant_photo_capture($request) {
    $id=$request['id'];
    if (!m9_variant_photo_pilot($id)) { return new WP_Error('m9_variant_photo_scope','Familia fuera del piloto.',['status'=>403]); }
    $guard=m9_bridge_isolation();
    if (($guard['origin']??null)!=='https://salmon-nightingale-251188.hostingersite.com'
        || empty($guard['mail_blocked']) || empty($guard['outbound_blocked']) || empty($guard['purchase_blocked'])
        || empty($guard['orders_blocked']) || ($guard['payment_gateways']??null)!==0) {
        return new WP_Error('m9_variant_photo_isolation','Aislamiento requerido.',['status'=>403]);
    }
    $entry=m9_bridge_receipt($request);
    if (is_wp_error($entry)) { return $entry; }
    if (($entry['protocol']??null)!=='m9-remote-family-1' || ($entry['state']??null)!=='SUCCEEDED'
        || ($entry['request_id']??null)!==$id || empty($entry['verified']['variants'])) {
        return new WP_Error('m9_variant_photo_receipt','Recibo de familia completa requerido.',['status'=>409]);
    }
    // Clean only related object caches before reading actual metadata.
    foreach(array_merge([(int)$entry['remote_product_id']],array_column($entry['verified']['variants'],'remote_variation_id')) as $pid) { clean_post_cache((int)$pid); }
    $gallery=m9_bridge_gallery($request);
    if (is_wp_error($gallery)) { return $gallery; }
    if (!m9_family_identity($entry)) { return new WP_Error('m9_variant_photo_identity','Identidad modificada.',['status'=>409]); }
    $variants=[];$ids=[];$codes=[];
    foreach($entry['verified']['variants'] as $v) {
        $child=wc_get_product((int)$v['remote_variation_id']);
        $price=$child->get_regular_price('edit');
        if (!is_string($price) || !preg_match('/^\d+(\.\d{1,2})?$/',$price)
            || (int)round((float)$price*100)!==$v['price_cents']) {
            return new WP_Error('m9_variant_photo_price','Precio modificado; revisar.',['status'=>409]);
        }
        $own=(int)$child->get_image_id('edit');$photo=null;
        if ($own) {
            $path=wp_get_original_image_path($own);$url=wp_get_original_image_url($own);
            if (!$path || !is_file($path) || !is_readable($path) || filesize($path)>4194304
                || !is_string($url) || strpos($url,rtrim(home_url(),'/').'/wp-content/uploads/')!==0) {
                return new WP_Error('m9_variant_photo_unavailable','Foto propia no verificable.',['status'=>409]);
            }
            $sha=hash_file('sha256',$path);
            if (!$sha) { return new WP_Error('m9_variant_photo_unavailable','Foto propia no verificable.',['status'=>409]); }
            $photo=['id'=>$own,'sha256'=>$sha,'alt'=>(string)get_post_meta($own,'_wp_attachment_image_alt',true)];
        }
        $variants[]=['variant_id'=>$v['variant_id'],'woo_variant_id'=>(int)$v['remote_variation_id'],
            'barcode'=>$v['barcode'],'price_cents'=>$v['price_cents'],'attributes'=>$v['attributes'],
            'own_image_id'=>$own,'own_image'=>$photo];
        $ids[]=$v['variant_id'];$codes[]=$v['barcode'];
    }
    if (count(array_unique($ids))!==count($ids) || count(array_unique($codes))!==count($codes)) {
        return new WP_Error('m9_variant_photo_duplicate','Identidad duplicada.',['status'=>409]);
    }
    $snapshot=['protocol'=>'m9-remote-variant-photo-read-1','origin'=>rtrim(home_url(),'/'),
        'request_id'=>$id,'product_id'=>$entry['product_id'],'woo_product_id'=>(int)$entry['remote_product_id'],
        'gallery_revision'=>$gallery['revision'],'images'=>$gallery['images'],'variants'=>$variants,
        'complete'=>true,'write_enabled'=>false];
    $snapshot['revision']=hash('sha256',wp_json_encode($snapshot));return $snapshot;
}
function m9_variant_photo_read($request) {
    // A stable double read detects observed concurrent changes. This is not a
    // transaction or permission to dispatch against a later remote revision.
    $first=m9_variant_photo_capture($request);
    if (is_wp_error($first)) { return $first; }
    $second=m9_variant_photo_capture($request);
    if (is_wp_error($second)) { return $second; }
    if (wp_json_encode($first)!==wp_json_encode($second)) {
        return new WP_Error('m9_variant_photo_changed','La evidencia cambió durante la lectura.',['status'=>409]);
    }
    return $second;
}
add_action('rest_api_init',function(){
    register_rest_route('m9-test/v1','/variant-photos/(?P<id>[0-9a-f-]{36})',[
        'methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_variant_photo_read']);
});
