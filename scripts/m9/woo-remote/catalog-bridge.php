<?php
// Loaded only by the origin-pinned isolation plugin. No generic Woo REST access.
if (!defined('ABSPATH') || !function_exists('m9_remote_test_origin') || !m9_remote_test_origin()) { return; }

add_action('init', function () {
    add_role('m9_test_catalog', 'M9 — Sólo catálogo de pruebas', array('read' => true, 'm9_test_catalog' => true));
});
add_action('application_password_did_authenticate', function ($user, $item) {
    if (in_array('m9_test_catalog', (array) $user->roles, true)) {
        $GLOBALS['m9_bridge_application_authenticated'] = true;
    }
}, 10, 2);
add_filter('application_password_is_api_request', function ($allowed) {
    return $allowed && defined('REST_REQUEST') && REST_REQUEST;
});
add_filter('rest_pre_dispatch', function ($result, $server, $request) {
    if (strpos($request->get_route(), '/m9-test/v1/') === 0) {
        do_action('litespeed_control_set_nocache', 'M9 authenticated catalogue');
    }
    if (current_user_can('m9_test_catalog') && !preg_match('#^/m9-test/v1/(isolation|drafts|families|(?:gallery-updates|variant-photo-assignments)(?:/[0-9a-f-]{36})?|(?:receipts|galleries|variant-photos)/[0-9a-f-]{36}|photos/[0-9a-f-]{36}/[1-9][0-9]*)$#i', $request->get_route())) {
        return new WP_Error('m9_scope_denied', 'Acceso limitado al catálogo de pruebas.', array('status' => 403));
    }
    return $result;
}, PHP_INT_MAX, 3);
add_filter('rest_post_dispatch', function ($response, $server, $request) {
    if (strpos($request->get_route(), '/m9-test/v1/') === 0) {
        $response->header('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
        $response->header('Vary', 'Authorization, Cookie');
    }
    return $response;
}, PHP_INT_MAX, 3);

function m9_bridge_permission() {
    return m9_remote_test_origin() && current_user_can('m9_test_catalog') &&
        !empty($GLOBALS['m9_bridge_application_authenticated']);
}
function m9_bridge_isolation() {
    $outbound = wp_remote_get('https://example.invalid/m9-isolation');
    return array(
        'variant_photo_write_protocol' => function_exists('m9_variant_photo_assign') ? 'm9-remote-variant-photo-write-1' : null,
        'family_protocol' => 'm9-remote-family-1', 'protocol' => 'm9-remote-draft-1', 'origin' => rtrim(home_url(), '/'),
        'mail_blocked' => apply_filters('pre_wp_mail', null, array()) === false,
        'outbound_blocked' => is_wp_error($outbound) && $outbound->get_error_code() === 'm9_test_outbound_blocked',
        'purchase_blocked' => apply_filters('woocommerce_is_purchasable', true) === false,
        'orders_blocked' => has_action('woocommerce_before_order_object_save', 'm9_test_block_order') !== false,
        'payment_gateways' => count(WC()->payment_gateways()->get_available_payment_gateways()),
    );
}
function m9_bridge_validate($p) {
    $keys = array('protocol','request_id','product_id','revision','name','description','short_description','barcode','price_cents','image');
    if (!is_array($p) || count($p) !== count($keys) || array_diff(array_keys($p), $keys)) { throw new Exception('INVALID_PACKET_FIELDS'); }
    $uuid = '/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i';
    if ($p['protocol'] !== 'm9-remote-draft-1' || !is_string($p['request_id']) || !is_string($p['product_id']) ||
        !preg_match($uuid, $p['request_id']) || !preg_match($uuid, $p['product_id']) || !is_int($p['revision']) || $p['revision'] < 1) { throw new Exception('INVALID_PACKET_IDENTITY'); }
    foreach (array('name'=>200,'description'=>20000,'short_description'=>2000,'barcode'=>100) as $key=>$limit) {
        if (!is_string($p[$key]) || trim($p[$key]) === '' || mb_strlen($p[$key]) > $limit || preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', $p[$key])) { throw new Exception('INVALID_TEXT'); }
    }
    if ($p['barcode'] !== trim($p['barcode'])) { throw new Exception('BARCODE_MUST_BE_LITERAL'); }
    if (!is_int($p['price_cents']) || $p['price_cents'] < 0 || $p['price_cents'] > 100000000) { throw new Exception('INVALID_PRICE'); }
    if (!is_array($p['image']) || count($p['image']) !== 2 || !isset($p['image']['base64'],$p['image']['sha256']) || !is_string($p['image']['base64']) || !is_string($p['image']['sha256']) || strlen($p['image']['base64']) > 5592408) { throw new Exception('INVALID_IMAGE'); }
    $bytes = base64_decode($p['image']['base64'], true);
    if ($bytes === false || strlen($bytes) === 0 || strlen($bytes) > 4194304 || base64_encode($bytes) !== $p['image']['base64'] || hash('sha256', $bytes) !== $p['image']['sha256']) { throw new Exception('INVALID_IMAGE_HASH_OR_SIZE'); }
    $size = @getimagesizefromstring($bytes);
    if (!$size || !in_array($size['mime'], array('image/jpeg','image/png','image/webp'), true) || $size[0] * $size[1] > 25000000) { throw new Exception('INVALID_IMAGE_FORMAT'); }
    // Fail instead of silently changing descriptions/codes during sanitization.
    if (sanitize_text_field($p['name']) !== $p['name'] || sanitize_text_field($p['barcode']) !== $p['barcode'] ||
        wp_kses_post($p['description']) !== $p['description'] || wp_kses_post($p['short_description']) !== $p['short_description']) { throw new Exception('UNSAFE_CONTENT'); }
    return array($bytes, $size['mime']);
}
function m9_bridge_receipt($request) {
    // Durable receipts must not depend on a persistent object-cache snapshot.
    global $wpdb;
    $raw = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", 'm9_remote_job_' . strtolower($request['id'])));
    $entry = $raw === null ? false : maybe_unserialize($raw);
    if (!$entry || $entry['owner'] !== get_current_user_id()) { return new WP_Error('m9_not_found','Sin recibo.',array('status'=>404)); }
    return $entry;
}
// Read only the live gallery of an identity already created by this account.
// Never expose an arbitrary product/media lookup or infer a link from its name.
function m9_bridge_gallery($request) {
    $entry = m9_bridge_receipt($request);
    if (is_wp_error($entry)) { return $entry; }
    if ($entry['state'] !== 'SUCCEEDED' || empty($entry['verified'])) {
        return new WP_Error('m9_gallery_unverified', 'Identidad pendiente de revisión.', array('status'=>409));
    }
    $product = wc_get_product((int)$entry['remote_product_id']);
    if (!$product || $product->get_status() !== 'draft' ||
        $product->get_meta('_mi_tienda_product_id') !== $entry['product_id'] ||
        $product->get_meta('_m9_remote_request') !== $entry['request_id'] ||
        $product->get_sku('edit') !== $entry['verified']['barcode'] ||
        $product->get_meta('_mi_tienda_barcode') !== $entry['verified']['barcode']) {
        return new WP_Error('m9_gallery_identity_changed', 'Identidad modificada; requiere revisión.', array('status'=>409));
    }
    if (($entry['protocol'] ?? '') === 'm9-remote-family-1' && !m9_family_identity($entry)) { return new WP_Error('m9_family_changed','Familia modificada; requiere revisión.',array('status'=>409)); }
    $cover = (int)$product->get_image_id('edit');
    $ids = array_merge($cover ? array($cover) : array(), array_map('intval', $product->get_gallery_image_ids('edit')));
    if (count($ids) > 20 || count(array_unique($ids)) !== count($ids)) {
        return new WP_Error('m9_gallery_review', 'Galería duplicada o fuera de límite.', array('status'=>409));
    }
    $images = array();
    foreach ($ids as $id) {
        $path = wp_get_original_image_path($id);
        $url = wp_get_original_image_url($id);
        if (!$path || !is_file($path) || !is_readable($path) || filesize($path) > 4194304 ||
            !is_string($url) || strpos($url, rtrim(home_url(), '/').'/wp-content/uploads/') !== 0) {
            return new WP_Error('m9_gallery_unavailable', 'No se pudo verificar toda la galería.', array('status'=>409));
        }
        $hash = hash_file('sha256', $path);
        if (!$hash) { return new WP_Error('m9_gallery_unavailable', 'Foto no verificable.', array('status'=>409)); }
        $images[] = array('id'=>$id, 'url'=>$url, 'sha256'=>$hash, 'alt'=>(string)get_post_meta($id, '_wp_attachment_image_alt', true));
    }
    $snapshot = array('origin'=>rtrim(home_url(), '/'), 'product_id'=>$entry['product_id'],
        'woo_product_id'=>(int)$entry['remote_product_id'], 'barcode'=>$entry['verified']['barcode'],
        'complete'=>true, 'images'=>$images);
    $snapshot['revision'] = hash('sha256', wp_json_encode($snapshot));
    return $snapshot;
}
// Deliver original bytes through the authenticated bridge; public media URLs
// can be transformed by hosting optimizers and are not evidence of original bytes.
function m9_bridge_photo($request) {
    $gallery = m9_bridge_gallery($request);
    if (is_wp_error($gallery)) { return $gallery; }
    $id = (int)$request['media_id'];
    foreach ($gallery['images'] as $image) {
        if ($image['id'] !== $id) { continue; }
        $bytes = file_get_contents(wp_get_original_image_path($id));
        if ($bytes === false || strlen($bytes) > 4194304 || hash('sha256', $bytes) !== $image['sha256']) {
            return new WP_Error('m9_photo_changed','Foto modificada durante la lectura.',array('status'=>409));
        }
        return array('sha256'=>$image['sha256'],'base64'=>base64_encode($bytes));
    }
    return new WP_Error('m9_photo_not_found','Foto fuera de esta galería.',array('status'=>404));
}
function m9_bridge_verified($p, $entry) {
    $id = (int) ($entry['remote_product_id'] ?? 0);
    $media = (int) ($entry['remote_image_id'] ?? 0);
    $check = $id ? wc_get_product($id) : false;
    if (!$check || !$media || $check->get_status() !== 'draft' || $check->get_sku('edit') !== $p['barcode'] ||
        $check->get_name('edit') !== $p['name'] || $check->get_description('edit') !== $p['description'] ||
        $check->get_short_description('edit') !== $p['short_description'] || (int) $check->get_image_id('edit') !== $media ||
        (int) round((float)$check->get_regular_price('edit')*100) !== $p['price_cents'] ||
        $check->get_meta('_mi_tienda_barcode') !== $p['barcode'] ||
        $check->get_meta('_mi_tienda_product_id') !== $p['product_id'] ||
        $check->get_meta('_m9_remote_request') !== $p['request_id'] || $check->is_purchasable()) { return false; }
    $original = wp_get_original_image_path($media);
    if (!$original || !is_file($original) || hash_file('sha256', $original) !== $p['image']['sha256']) { return false; }
    return array('status'=>'draft','barcode'=>$check->get_sku('edit'),'price_cents'=>$p['price_cents'],
        'name'=>$check->get_name('edit'),'description'=>$check->get_description('edit'),
        'short_description'=>$check->get_short_description('edit'),'image_id'=>$media,
        'image_sha256'=>$p['image']['sha256'],'purchasable'=>false);
}
function m9_bridge_create($request) {
    $p = $request->get_json_params();
    try { list($bytes, $mime) = m9_bridge_validate($p); }
    catch (Throwable $e) { return new WP_Error('m9_invalid_packet', 'Paquete inválido: '.$e->getMessage(), array('status'=>400)); }
    $isolation = m9_bridge_isolation();
    if (!$isolation['mail_blocked'] || !$isolation['outbound_blocked'] || !$isolation['purchase_blocked'] || !$isolation['orders_blocked'] || $isolation['payment_gateways'] !== 0) { return new WP_Error('m9_isolation_failed','Aislamiento requerido.',array('status'=>403)); }
    $p['request_id'] = strtolower($p['request_id']); $p['product_id'] = strtolower($p['product_id']);
    ksort($p); ksort($p['image']);
    $fingerprint = hash('sha256', wp_json_encode($p));
    $key = 'm9_remote_job_'.$p['request_id'];
    $existing = get_option($key);
    if ($existing) {
        if ($existing['owner'] !== get_current_user_id() || $existing['fingerprint'] !== $fingerprint) { return new WP_Error('m9_job_conflict','La solicitud cambió.',array('status'=>409)); }
        // Recover only by reading the IDs already recorded. Never create or rewrite assets.
        if ($existing['state'] === 'REVIEW_REQUIRED' && !empty($existing['remote_product_id']) && !empty($existing['remote_image_id'])) {
            $verified = m9_bridge_verified($p, $existing);
            if ($verified) {
                $existing['previous_state'] = $existing['state'];
                $existing['state'] = 'SUCCEEDED';
                $existing['reconciliation'] = 'existing_ids_exact_content_and_image_hash';
                $existing['verified'] = $verified;
                update_option($key, $existing, false);
            }
        }
        return $existing; // Never replay a partial or uncertain write.
    }
    $entry = array('owner'=>get_current_user_id(),'request_id'=>$p['request_id'],'product_id'=>$p['product_id'],'revision'=>$p['revision'],'fingerprint'=>$fingerprint,'state'=>'DISPATCHING');
    if (!add_option($key, $entry, '', false)) { return new WP_Error('m9_job_locked','Solicitud en proceso; consulte el recibo.',array('status'=>409)); }
    // Persistent product lock: another request ID cannot create the same identity.
    if (!add_option('m9_remote_product_'.$p['product_id'], $p['request_id'], '', false)) {
        $entry['state']='REVIEW_REQUIRED'; update_option($key,$entry,false);
        return new WP_Error('m9_product_exists','Identidad ya enviada; revisión requerida.',array('status'=>409));
    }
    try {
        if (wc_get_product_id_by_sku($p['barcode'])) { throw new Exception('DUPLICATE_BARCODE'); }
        $product = new WC_Product_Simple();
        $product->set_name($p['name']); $product->set_status('draft');
        $product->set_description($p['description']); $product->set_short_description($p['short_description']);
        $product->set_sku($p['barcode']);
        $product->set_regular_price(number_format($p['price_cents']/100,2,'.',''));
        $product->update_meta_data('_mi_tienda_barcode',$p['barcode']);
        $product->update_meta_data('_mi_tienda_product_id',$p['product_id']);
        $product->update_meta_data('_m9_remote_request',$p['request_id']);
        $product->update_meta_data('_m9_test_only','yes');
        $id = $product->save();
        if (!$id) { throw new Exception('PRODUCT_SAVE_FAILED'); }
        $entry['remote_product_id']=$id; update_option($key,$entry,false);
        require_once ABSPATH.'wp-admin/includes/file.php';
        require_once ABSPATH.'wp-admin/includes/media.php';
        require_once ABSPATH.'wp-admin/includes/image.php';
        $ext = array('image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp')[$mime];
        $tmp = wp_tempnam('m9-image');
        if (!$tmp || file_put_contents($tmp,$bytes) !== strlen($bytes)) { throw new Exception('IMAGE_WRITE_FAILED'); }
        try {
            $media = media_handle_sideload(array('name'=>'m9-'.$p['request_id'].'.'.$ext,'tmp_name'=>$tmp,'error'=>0,'size'=>strlen($bytes)), $id);
        } finally { if (is_file($tmp)) { unlink($tmp); } }
        if (is_wp_error($media)) { throw new Exception('IMAGE_SAVE_FAILED'); }
        $entry['remote_image_id']=$media; update_option($key,$entry,false);
        $product->set_image_id($media); $product->save();
        $verified = m9_bridge_verified($p, $entry);
        if (!$verified) { throw new Exception('READBACK_FAILED'); }
        $entry['state']='SUCCEEDED';
        $entry['verified']=$verified;
        update_option($key,$entry,false);
        return $entry;
    } catch (Throwable $e) {
        $entry['state']='REVIEW_REQUIRED'; $entry['error']='WRITE_REQUIRES_REVIEW';
        update_option($key,$entry,false);
        return new WP_Error('m9_write_review','Consulte el recibo; no vuelva a crear el producto.',array('status'=>409));
    }
}
add_action('rest_api_init', function () {
    register_rest_route('m9-test/v1','/isolation',array('methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_bridge_isolation'));
    register_rest_route('m9-test/v1','/drafts',array('methods'=>'POST','permission_callback'=>'m9_bridge_permission','callback'=>'m9_bridge_create'));
    register_rest_route('m9-test/v1','/receipts/(?P<id>[0-9a-f-]{36})',array('methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_bridge_receipt'));
    register_rest_route('m9-test/v1','/photos/(?P<id>[0-9a-f-]{36})/(?P<media_id>[1-9][0-9]*)',array('methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_bridge_photo'));
    register_rest_route('m9-test/v1','/galleries/(?P<id>[0-9a-f-]{36})',array('methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_bridge_gallery'));
});
