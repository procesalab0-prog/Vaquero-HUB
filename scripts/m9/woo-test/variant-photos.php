<?php
// Local rehearsal only. Never loaded by the remote plugin or production.
if (!defined('ABSPATH')) { return; }
function m9_local_variant_photo_enabled() {
    if (wp_get_environment_type()!=='local' || home_url()!=='http://127.0.0.1:9417'
        || (defined('M9_RECOVERY_READ_ONLY') && M9_RECOVERY_READ_ONLY)
        || !function_exists('m9_local_snapshot') || !defined('DISABLE_WP_CRON') || !DISABLE_WP_CRON
        || !defined('WP_HTTP_BLOCK_EXTERNAL') || !WP_HTTP_BLOCK_EXTERNAL) { return false; }
    $network=apply_filters('pre_http_request',false,[],'https://example.invalid/m9-isolation');
    return is_wp_error($network) && $network->get_error_code()==='m9_network_blocked'
        && apply_filters('pre_wp_mail',null,[])===false
        && apply_filters('woocommerce_webhook_should_deliver',true)===false
        && apply_filters('woocommerce_is_purchasable',true,null)===false
        && function_exists('WC') && count(WC()->payment_gateways()->get_available_payment_gateways())===0;
}
function m9_local_variant_photo_context($request) {
    if (!m9_local_variant_photo_enabled()) { return new WP_Error('m9_local_only','Laboratorio local requerido.',['status'=>403]); }
    $pid=(int)$request['product_id'];$vid=(int)$request['variant_id'];
    wp_cache_flush();
    $parent=wc_get_product($pid);$child=wc_get_product($vid);
    if (!$parent || !$child || !$parent->is_type('variable') || !$child->is_type('variation')
        || $parent->get_status()!=='draft' || !$parent->get_meta('_mi_tienda_test_operation')
        || (int)$child->get_parent_id()!==$pid || !$child->get_meta('_mi_tienda_variant_id')
        || !$child->get_meta('_mi_tienda_barcode')) {
        return new WP_Error('m9_variant_identity','Familia de ensayo identificada requerida.',['status'=>409]);
    }
    $read=function($route) {
        $r=rest_do_request(new WP_REST_Request('GET',$route));
        return $r->is_error() || $r->get_status()!==200 ? null : rest_get_server()->response_to_data($r,false);
    };
    $p=$read('/wc/v3/products/'.$pid);$v=$read('/wc/v3/products/'.$pid.'/variations/'.$vid);
    if (!$p || !$v) { return new WP_Error('m9_variant_read','Lectura incompleta.',['status'=>409]); }
    $media=[];$ids=array_merge([(int)$parent->get_image_id('edit')],array_map('intval',$parent->get_gallery_image_ids('edit')));
    $ids=array_values(array_filter($ids));
    if (count($ids)>20 || count(array_unique($ids))!==count($ids)) { return new WP_Error('m9_variant_media','Galería ambigua.',['status'=>409]); }
    foreach($ids as $id) {
        $file=wp_get_original_image_path($id);$url=wp_get_original_image_url($id);
        if (!$file || !is_file($file) || !is_readable($file) || filesize($file)>4194304
            || !is_string($url) || strpos($url,home_url().'/wp-content/uploads/')!==0) {
            return new WP_Error('m9_variant_media','Archivo no verificable.',['status'=>409]);
        }
        $media[]=['id'=>$id,'sha256'=>hash_file('sha256',$file),'alt'=>(string)get_post_meta($id,'_wp_attachment_image_alt',true)];
    }
    $result=['protocol'=>'m9-local-variant-photo-1','origin'=>home_url(),'parent'=>$p,'variant'=>$v,
        'own_image_id'=>(int)$child->get_image_id('edit'),'media'=>$media];
    $result['revision']=hash('sha256',m9_local_snapshot($result));return $result;
}
function m9_local_variant_photo_receipt($request) {
    global $wpdb;
    if (!m9_local_variant_photo_enabled()) { return new WP_Error('m9_local_only','Laboratorio local requerido.',['status'=>403]); }
    $raw=$wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s",'m9_local_variant_photo_'.$request['update_id']));
    $entry=$raw===null ? null : maybe_unserialize($raw);
    if (!$entry || $entry['owner']!==get_current_user_id()) { return new WP_Error('m9_receipt_missing','Sin recibo.',['status'=>404]); }
    return $entry;
}
function m9_local_variant_photo_assign($request) {
    global $wpdb;
    if (!m9_local_variant_photo_enabled()) { return new WP_Error('m9_local_only','Laboratorio local requerido.',['status'=>403]); }
    $p=$request->get_json_params();
    $keys=['update_id','product_id','variant_id','expected_revision','image_id','image_sha256','image_alt'];
    if (!is_array($p) || count($p)!==count($keys) || array_diff(array_keys($p),$keys)
        || !is_string($p['update_id']) || !preg_match('/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/',$p['update_id'])
        || !is_int($p['product_id']) || $p['product_id']<1 || !is_int($p['variant_id']) || $p['variant_id']<1
        || !is_int($p['image_id']) || $p['image_id']<1 || !is_string($p['expected_revision'])
        || !preg_match('/^[a-f0-9]{64}$/',$p['expected_revision']) || !is_string($p['image_sha256'])
        || !preg_match('/^[a-f0-9]{64}$/',$p['image_sha256']) || !is_string($p['image_alt']) || strlen($p['image_alt'])>500) {
        return new WP_Error('m9_variant_packet','Paquete inválido.',['status'=>400]);
    }
    $key='m9_local_variant_photo_'.$p['update_id'];$fingerprint=hash('sha256',m9_local_snapshot($p));
    $prior=m9_local_variant_photo_receipt($p);
    if (!is_wp_error($prior)) {
        if ($prior['fingerprint']!==$fingerprint) { return new WP_Error('m9_request_changed','Solicitud modificada.',['status'=>409]); }
        return $prior; // Includes uncertain outcomes; never dispatch a second time.
    }
    if ($prior->get_error_code()!=='m9_receipt_missing') { return $prior; }
    $token=wp_generate_uuid4();$previous=$wpdb->suppress_errors(true);
    try { $locked=$wpdb->query($wpdb->prepare("INSERT INTO {$wpdb->options} (option_name,option_value,autoload) VALUES (%s,%s,%s)",'m9_conditional_write_lock',$token,'off')); }
    finally { $wpdb->suppress_errors($previous); }
    if ($locked!==1) { return new WP_Error('m9_writer_locked','Escritor ocupado; consultar recibo.',['status'=>423]); }
    $entry=null;
    try {
        $context=m9_local_variant_photo_context($p);
        if (is_wp_error($context)) { return $context; }
        if ($context['revision']!==$p['expected_revision']) { return new WP_Error('m9_variant_changed','Contexto cambiado.',['status'=>409]); }
        $matched=array_values(array_filter($context['media'],fn($m)=>$m['id']===$p['image_id'] && $m['sha256']===$p['image_sha256'] && $m['alt']===$p['image_alt']));
        if (count($matched)!==1) { return new WP_Error('m9_photo_binding','Foto fuera de la galería verificada.',['status'=>409]); }
        if ($context['own_image_id']!==0 && $context['own_image_id']!==$p['image_id']) { return new WP_Error('m9_photo_conflict','No sobrescribir una foto propia distinta.',['status'=>409]); }
        $entry=['owner'=>get_current_user_id(),'update_id'=>$p['update_id'],'fingerprint'=>$fingerprint,
            'state'=>'APPLYING','product_id'=>$p['product_id'],'variant_id'=>$p['variant_id'],
            'image_id'=>$p['image_id'],'before_own_image_id'=>$context['own_image_id']];
        $previous=$wpdb->suppress_errors(true);
        try { $created=$wpdb->query($wpdb->prepare("INSERT INTO {$wpdb->options} (option_name,option_value,autoload) VALUES (%s,%s,%s)",$key,maybe_serialize($entry),'off')); }
        finally { $wpdb->suppress_errors($previous); }
        if ($created!==1) { return new WP_Error('m9_receipt_busy','Consulte el recibo.',['status'=>409]); }
        // Exactly one child metadata field. No uploads, parent/gallery/alt edits,
        // price, identity, attributes, stock, orders or publication changes.
        if ($context['own_image_id']!==$p['image_id']) { update_post_meta($p['variant_id'],'_thumbnail_id',$p['image_id']); }
        clean_post_cache($p['variant_id']);
        $after=m9_local_variant_photo_context($p);
        if (is_wp_error($after) || $after['own_image_id']!==$p['image_id'] || m9_local_snapshot($after['parent'])!==m9_local_snapshot($context['parent']) || m9_local_snapshot($after['media'])!==m9_local_snapshot($context['media'])) { throw new Exception('READBACK_REVIEW'); }
        $strip=function($v){unset($v['image'],$v['date_modified'],$v['date_modified_gmt']);return $v;};
        if (m9_local_snapshot($strip($after['variant']))!==m9_local_snapshot($strip($context['variant']))) { throw new Exception('PROTECTED_FIELDS_CHANGED'); }
        $entry['state']='SUCCEEDED';$entry['after_revision']=$after['revision'];
        update_option($key,$entry,false);return $entry;
    } catch(Throwable $e) {
        if ($entry!==null) { $entry['state']='REVIEW_REQUIRED';update_option($key,$entry,false); }
        return new WP_Error('m9_photo_review','Resultado incierto; consultar recibo sin repetir.',['status'=>409]);
    } finally {
        $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name=%s AND option_value=%s",'m9_conditional_write_lock',$token));
    }
}
// Explicit reconciliation of an uncertain result. The original packet hash and
// original context revision bind the supplied before-evidence to that receipt.
// This confirms metadata only; it never repeats the photo assignment.
function m9_local_variant_photo_confirm($request) {
    global $wpdb;
    $data=$request->get_json_params();
    if (!is_array($data) || count($data)!==2 || !isset($data['packet'],$data['before_context']) || !is_array($data['packet']) || !is_array($data['before_context'])) {
        return new WP_Error('m9_confirmation_packet','Evidencia anterior requerida.',['status'=>400]);
    }
    $entry=m9_local_variant_photo_receipt($request);
    if (is_wp_error($entry)) { return $entry; }
    $packet=$data['packet'];$before=$data['before_context'];$original=$before;unset($original['revision']);
    if (($packet['update_id']??null)!==$request['update_id'] || hash('sha256',m9_local_snapshot($packet))!==$entry['fingerprint']
        || ($before['revision']??null)!==($packet['expected_revision']??null)
        || hash('sha256',m9_local_snapshot($original))!==$before['revision']) {
        return new WP_Error('m9_confirmation_identity','Evidencia no corresponde al recibo.',['status'=>409]);
    }
    if ($entry['state']==='SUCCEEDED') { return $entry; }
    $token=wp_generate_uuid4();$previous=$wpdb->suppress_errors(true);
    try { $locked=$wpdb->query($wpdb->prepare("INSERT INTO {$wpdb->options} (option_name,option_value,autoload) VALUES (%s,%s,%s)",'m9_conditional_write_lock',$token,'off')); }
    finally { $wpdb->suppress_errors($previous); }
    if ($locked!==1) { return new WP_Error('m9_writer_locked','Escritor ocupado.',['status'=>423]); }
    try {
        $current=m9_local_variant_photo_context($packet);
        if (is_wp_error($current)) { return $current; }
        $protected=function($c){unset($c['revision'],$c['own_image_id'],$c['variant']['image']);return $c;};
        $matched=array_values(array_filter($current['media'],fn($m)=>$m['id']===$packet['image_id'] && $m['sha256']===$packet['image_sha256'] && $m['alt']===$packet['image_alt']));
        if ($current['own_image_id']!==$packet['image_id'] || count($matched)!==1 || m9_local_snapshot($protected($current))!==m9_local_snapshot($protected($before))) {
            return new WP_Error('m9_confirmation_changed','La evidencia cambió; mantener revisión.',['status'=>409]);
        }
        $entry['state']='SUCCEEDED';$entry['after_revision']=$current['revision'];$entry['reconciled_without_photo_write']=true;
        update_option('m9_local_variant_photo_'.$request['update_id'],$entry,false);return $entry;
    } finally { $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name=%s AND option_value=%s",'m9_conditional_write_lock',$token)); }
}
add_action('rest_api_init',function(){
    $permission=fn()=>m9_local_variant_photo_enabled() && current_user_can('manage_woocommerce');
    register_rest_route('m9-local/v1','/variant-photos/(?P<product_id>[1-9][0-9]*)/(?P<variant_id>[1-9][0-9]*)',['methods'=>'GET','permission_callback'=>$permission,'callback'=>'m9_local_variant_photo_context']);
    register_rest_route('m9-local/v1','/variant-photo-assignments',['methods'=>'POST','permission_callback'=>$permission,'callback'=>'m9_local_variant_photo_assign']);
    register_rest_route('m9-local/v1','/variant-photo-assignments/(?P<update_id>[a-f0-9-]{36})',['methods'=>'GET','permission_callback'=>$permission,'callback'=>'m9_local_variant_photo_receipt']);
    register_rest_route('m9-local/v1','/variant-photo-assignments/(?P<update_id>[a-f0-9-]{36})/confirm',['methods'=>'POST','permission_callback'=>$permission,'callback'=>'m9_local_variant_photo_confirm']);
});
// Read-only visual evidence for the existing local pilot, never a storefront.
add_action('template_redirect',function(){
    if (!m9_local_variant_photo_enabled() || parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH)!=='/m9-fotos-variantes/') { return; }
    $p=wc_get_product(23);
    if (!$p || $p->get_status()!=='draft' || !$p->get_meta('_mi_tienda_test_operation')) { status_header(404);exit; }
    status_header(200);header('Content-Type: text/html; charset=UTF-8');header('Cache-Control: no-store');
    echo '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fotos por talla · Laboratorio M9</title><style>body{font:17px/1.5 system-ui;background:#f5f2ed;color:#29362f;max-width:1040px;margin:40px auto;padding:20px}article{padding:24px;background:white;border-radius:18px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #ddd}img{width:90px;height:110px;object-fit:contain}.banner{background:#f9e7bc;padding:16px;border-radius:10px}</style><p>MI TIENDA · LABORATORIO LOCAL</p><h1>Foto propia de cada talla</h1><p class="banner">Sólo pruebas en esta computadora. Borrador no comprable. No modifica la tienda real ni inventario.</p><article><h2>'.esc_html($p->get_name()).'</h2><table><tr><th>Talla</th><th>Código original</th><th>Precio</th><th>Foto</th><th>Comprobación</th></tr>';
    foreach([24,25,26,27,28] as $id) {
        $v=wc_get_product($id);if (!$v || (int)$v->get_parent_id()!==23) { continue; }
        $image=(int)$v->get_image_id('edit');
        echo '<tr><td>'.esc_html(implode(' / ',$v->get_attributes())).'</td><td>'.esc_html($v->get_meta('_mi_tienda_barcode')).'</td><td>'.wp_kses_post(wc_price($v->get_regular_price())).'</td><td>'.($image ? wp_get_attachment_image($image,'thumbnail') : 'Sin foto propia').'</td><td>'.esc_html($image ? 'Foto asignada a esta talla · '.$image : 'Sólo portada general heredada').'</td></tr>';
    }
    echo '</table><p>Las cinco tallas comparten la misma foto porque así aparece en la fuente conciliada. Cada talla conserva su código y su vínculo independiente.</p><p>Esta pantalla demuestra el ensayo local. La conexión de fotos por talla con la página publicada sigue pendiente.</p></article></html>';exit;
});
