<?php
/**
 * Plugin Name: Mi Tienda SM — Aislamiento de pruebas
 * Description: Bloquea ventas, correo y conexiones salientes sólo en el laboratorio remoto M9.
 * Version: 1.2.0
 */
if (!defined('ABSPATH')) { exit; }
function m9_remote_test_origin() {
    return rtrim(home_url(), '/') === 'https://salmon-nightingale-251188.hostingersite.com';
}
register_activation_hook(__FILE__, function () {
    if (!m9_remote_test_origin()) { wp_die('M9: este plugin sólo se permite en el sitio remoto de pruebas autorizado.'); }
});
if (!m9_remote_test_origin()) { return; }
add_filter('pre_wp_mail', '__return_false', PHP_INT_MAX);
add_filter('pre_http_request', function () { return new WP_Error('m9_test_outbound_blocked', 'Conexiones salientes bloqueadas en pruebas.'); }, PHP_INT_MAX);
add_filter('woocommerce_available_payment_gateways', '__return_empty_array', PHP_INT_MAX);
add_filter('woocommerce_webhook_should_deliver', '__return_false', PHP_INT_MAX);
add_filter('woocommerce_is_purchasable', '__return_false', PHP_INT_MAX);
add_filter('woocommerce_variation_is_purchasable', '__return_false', PHP_INT_MAX);
add_filter('woocommerce_add_to_cart_validation', '__return_false', PHP_INT_MAX);
add_action('woocommerce_check_cart_items', function () {
    wc_add_notice('Entorno de pruebas: los pedidos están deshabilitados.', 'error');
});
function m9_test_block_order() {
    throw new Exception('M9_TEST_ORDERS_DISABLED');
}
add_action('woocommerce_before_order_object_save', 'm9_test_block_order', PHP_INT_MAX);
add_filter('rest_pre_dispatch', function ($result, $server, $request) {
    // Writes remain closed until the dedicated, reviewed remote bridge exists.
    if (preg_match('#^/wc(?:/|-)#', $request->get_route()) && !in_array($request->get_method(), array('GET', 'HEAD', 'OPTIONS'), true)) {
        return new WP_Error('m9_test_writes_disabled', 'Laboratorio remoto: escritura API todavía deshabilitada.', array('status' => 403));
    }
    return $result;
}, PHP_INT_MAX, 3);
add_filter('wp_insert_post_data', function ($data) {
    if (in_array($data['post_type'] ?? '', array('product', 'product_variation'), true) && ($data['post_status'] ?? '') === 'publish') {
        $data['post_status'] = 'draft';
    }
    return $data;
}, PHP_INT_MAX);
add_action('admin_notices', function () {
    echo '<div class="notice notice-warning"><p><strong>MI TIENDA SM — SÓLO PRUEBAS.</strong> Ventas, pagos, correos, webhooks y conexiones salientes bloqueados. Conector limitado al programa de pruebas. Tienda real separada.</p></div>';
});
add_action('admin_menu', function () {
    add_management_page('Pruebas M9', 'Pruebas M9', 'manage_options', 'm9-test-status', 'm9_remote_test_status');
});
function m9_remote_test_status() {
    if (!current_user_can('manage_options')) { wp_die('Sin permiso.'); }
    $outbound = wp_remote_get('https://example.invalid/m9-test');
    $checks = array(
        'Destino autorizado' => m9_remote_test_origin(),
        'Correo bloqueado' => apply_filters('pre_wp_mail', null, array()) === false,
        'Red saliente bloqueada' => is_wp_error($outbound) && $outbound->get_error_code() === 'm9_test_outbound_blocked',
        'Pagos disponibles: cero' => function_exists('WC') && count(WC()->payment_gateways()->get_available_payment_gateways()) === 0,
        'Webhooks bloqueados' => apply_filters('woocommerce_webhook_should_deliver', true) === false,
        'Compra bloqueada' => apply_filters('woocommerce_is_purchasable', true) === false,
        'Variaciones bloqueadas' => apply_filters('woocommerce_variation_is_purchasable', true) === false,
        'Carrito bloqueado' => apply_filters('woocommerce_add_to_cart_validation', true) === false,
    );
    echo '<div class="wrap"><h1>Mi Tienda SM — Pruebas M9</h1><p>Protección 1.2.0. Este sitio está separado de la tienda real.</p><ul>';
    foreach ($checks as $label => $ok) { echo '<li>'.esc_html(($ok ? 'OK — ' : 'FALLO — ').$label).'</li>'; }
    echo '</ul><p>Conector de catálogo y fotos disponible para pruebas. La API general Woo permanece bloqueada.</p></div>';
}
require_once __DIR__ . '/catalog-bridge.php';

require_once __DIR__ . '/gallery-write.php';
