<?php
/** Local rehearsal only. Never install on a live WordPress site. */
if (wp_get_environment_type() !== 'local') { http_response_code(503); exit('M9 requires a local test environment'); }
add_filter('pre_wp_mail', '__return_false');
add_filter('pre_http_request', function () { return new WP_Error('m9_network_blocked', 'External requests are disabled in the local test store.'); }, PHP_INT_MAX);
add_filter('woocommerce_available_payment_gateways', '__return_empty_array', PHP_INT_MAX);
add_filter('woocommerce_webhook_should_deliver', '__return_false', PHP_INT_MAX);
add_filter('wp_is_application_passwords_available', '__return_true');
add_filter('rest_pre_dispatch', function ($result, $server, $request) {
    if (preg_match('#^/(wc/store/.*checkout|wc/v[0-9]+/(orders|customers|webhooks|payment_gateways))#', $request->get_route()) && $request->get_method() !== 'GET') {
        return new WP_Error('m9_sales_disabled', 'Local catalog rehearsal only.', array('status' => 403));
    }
    return $result;
}, 10, 3);
add_action('admin_notices', function () { echo '<div class="notice notice-warning"><p><strong>MI TIENDA SM — PRUEBAS LOCALES. Sin ventas, pagos, correos ni conexión a la tienda real.</strong></p></div>'; });
add_filter('woocommerce_is_purchasable', '__return_false', PHP_INT_MAX);
add_action('rest_api_init', function () {
    register_rest_route('m9-local/v1', '/isolation', array(
        'methods' => 'GET',
        'permission_callback' => function () { return current_user_can('manage_woocommerce'); },
        'callback' => function () {
            $response = wp_remote_get('https://example.invalid/m9-isolation-check');
            return array('wordpress' => get_bloginfo('version'), 'woocommerce' => WC_VERSION,
                'environment' => wp_get_environment_type(), 'url' => home_url(),
                'cron_disabled' => defined('DISABLE_WP_CRON') && DISABLE_WP_CRON,
                'outbound_blocked' => is_wp_error($response) && $response->get_error_code() === 'm9_network_blocked',
                'mail_blocked' => wp_mail('nobody@example.invalid', 'Local isolation check', 'No message may leave this installation.') === false,
                'payment_gateways' => count(WC()->payment_gateways()->get_available_payment_gateways()),
                'webhooks_enabled' => apply_filters('woocommerce_webhook_should_deliver', true) === true,
                'orders' => count(wc_get_orders(array('limit' => -1, 'return' => 'ids'))));
        }
    ));
});
add_action('template_redirect', function () {
    if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) !== '/m9-laboratorio/') return;
    status_header(200); header('Content-Type: text/html; charset=UTF-8'); header('Cache-Control: no-store');
    echo '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Laboratorio WooCommerce · Mi Tienda SM</title><style>body{font:17px system-ui;background:#f5f1eb;color:#30291f;margin:0}main{max-width:900px;margin:40px auto;padding:24px}h1{font-size:32px}.banner{background:#fff0c7;padding:18px;border-radius:12px}article{background:white;border-radius:16px;padding:24px;margin:20px 0}img{max-width:180px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:12px;border-bottom:1px solid #ddd}code{font-size:16px}.tag{color:#9a451d}</style><main><p>MI TIENDA SM · WOOCOMMERCE</p><h1>Productos de prueba</h1><p class="banner">Este laboratorio está en tu equipo. Contiene ejemplos ficticios y copias de catálogo para ensayo; todos permanecen como borradores. No hay ventas, pagos ni correos; no está conectado a la tienda real.</p>';
    $products=wc_get_products(array('status'=>'draft','limit'=>20,'orderby'=>'ID','order'=>'ASC'));
    foreach($products as $p) {
        if (!$p->get_meta('_mi_tienda_test_operation')) continue;
        echo '<article><p class="tag">BORRADOR · SOLO PRUEBAS</p><h2>'.esc_html($p->get_name()).'</h2>';
        foreach(array_filter(array_merge(array($p->get_image_id()),$p->get_gallery_image_ids())) as $image_id) echo wp_get_attachment_image($image_id,'medium');
        echo wp_kses_post($p->get_description()).'<p>Código base: '.wp_kses_post($p->get_short_description()).'</p><table><tr><th>Variante</th><th>Código de barras</th><th>Precio público</th></tr>';
        $ids=$p->is_type('variable')?$p->get_children():array($p->get_id());
        foreach($ids as $id) { $v=wc_get_product($id); echo '<tr><td>'.esc_html(implode(' / ',$v->get_attributes()) ?: 'Única').'</td><td><code>'.esc_html($v->get_meta('_mi_tienda_barcode')).'</code></td><td>'.wp_kses_post(wc_price($v->get_regular_price())).'</td></tr>'; }
        echo '</table><p>Referencia WooCommerce local: '.esc_html($p->get_id()).'</p></article>';
    }
    echo '</main></html>'; exit;
});
