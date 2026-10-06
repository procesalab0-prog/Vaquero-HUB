<?php
/** Local rehearsal only. Never install on a live WordPress site. */
if (wp_get_environment_type() !== 'local') { http_response_code(503); exit('M9 requires a local test environment'); }
if (defined('M9_RECOVERY_READ_ONLY') && M9_RECOVERY_READ_ONLY && isset($_SERVER['REQUEST_METHOD'])) {
    $recovery_path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    $read_path = preg_match('#^/(m9-laboratorio/?|wp-json/m9-local/v1/isolation/?|wp-json/wc/v3/products(?:/[1-9][0-9]*(?:/variations(?:/[1-9][0-9]*)?)?)?/?)$#', $recovery_path ?? '');
    if (!in_array($_SERVER['REQUEST_METHOD'], array('GET', 'HEAD'), true) || !$read_path || isset($_GET['_method']) || isset($_GET['rest_route']) || isset($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) { http_response_code(403); exit('M9 recovery is read only'); }
}
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
                'display_policy' => function_exists('m9_display_policy_version') ? m9_display_policy_version() : null,
                'environment' => wp_get_environment_type(), 'url' => home_url(),
                'recovery_read_only' => defined('M9_RECOVERY_READ_ONLY') && M9_RECOVERY_READ_ONLY,
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
    if (defined('M9_RECOVERY_READ_ONLY') && M9_RECOVERY_READ_ONLY) echo '<p class="banner"><strong>Copia recuperada — solo lectura.</strong> Respaldo restaurado para comprobar productos, códigos e imágenes. Esta copia rechaza escrituras.</p>';
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

// Serialized local REST updates only. Never deploy this rehearsal guard to production.
// A crash leaves the option lock in place for manual inspection; it never expires.
function m9_local_snapshot($value) {
    $value = json_decode(wp_json_encode($value), true);
    $sort = function ($v) use (&$sort) {
        if (!is_array($v)) return $v;
        if (!array_is_list($v)) ksort($v, SORT_STRING);
        foreach ($v as $k => $child) $v[$k] = $sort($child);
        return $v;
    };
    return wp_json_encode($sort($value));
}
add_filter('rest_pre_dispatch', function ($result, $server, $request) {
    if (preg_match('#^/wc/v3/products(?:/|$)#', $request->get_route())
        && !($request->get_method() === 'POST' && preg_match('#^/wc/v3/products(?:/[1-9][0-9]*/variations|/categories)?/?$#', $request->get_route()))
        && in_array($request->get_method(), array('PUT', 'POST', 'PATCH', 'DELETE'), true)
        && empty($GLOBALS['m9_local_guard_dispatch'])) {
        return new WP_Error('m9_conditional_required', 'Use the guarded local update route.', array('status' => 409));
    }
    return $result;
}, 20, 3);
add_action('rest_api_init', function () {
    register_rest_route('m9-local/v1', '/conditional-update', array(
        'methods' => 'POST',
        'permission_callback' => function () { return current_user_can('manage_woocommerce'); },
        'callback' => function ($request) {
            if (wp_get_environment_type() !== 'local' || home_url() !== 'http://127.0.0.1:9417'
                || (defined('M9_RECOVERY_READ_ONLY') && M9_RECOVERY_READ_ONLY))
                return new WP_Error('m9_local_only', 'Local writable laboratory required.', array('status' => 403));
            $data = $request->get_json_params();
            $path = $data['path'] ?? '';
            $expected = $data['expected'] ?? null;
            $payload = $data['payload'] ?? null;
            if (!is_string($path) || !preg_match('#^products/([1-9][0-9]*)(?:/variations/([1-9][0-9]*))?$#', $path, $ids)
                || !is_array($expected) || !is_array($payload) || !$payload
                || ($expected['id'] ?? null) !== (int) end($ids))
                return new WP_Error('m9_invalid_update', 'Explicit identity and snapshot required.', array('status' => 400));
            $allowed = array('name', 'description', 'short_description', 'regular_price', 'meta_data', 'categories', 'images');
            if (array_diff(array_keys($payload), $allowed))
                return new WP_Error('m9_field_blocked', 'Unsupported update fields.', array('status' => 400));
            foreach (($payload['meta_data'] ?? array()) as $meta) {
                if (is_array($meta) && ($meta['key'] ?? '') === '_m9_display_only' && ($meta['value'] ?? '') === 'yes') continue;
                if (!is_array($meta) || ($meta['key'] ?? '') !== '_mi_tienda_test_operation'
                    || !is_string($meta['value'] ?? null) || !preg_match('/^[a-f0-9]{64}$/', $meta['value']))
                    return new WP_Error('m9_identity_immutable', 'Identity metadata cannot be updated.', array('status' => 400));
            }
            // Plain unique INSERT: add_option uses an upsert and is not a mutex.
            // No timed lease stealing; a crash keeps the row for operator review.
            global $wpdb;
            $token = wp_generate_uuid4();
            $previous_errors = $wpdb->suppress_errors(true);
            try {
                $acquired = $wpdb->query($wpdb->prepare(
                    "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, %s)",
                    'm9_conditional_write_lock', $token, 'off'
                ));
            } finally { $wpdb->suppress_errors($previous_errors); }
            if ($acquired !== 1)
                return new WP_Error('m9_writer_locked', 'Writer busy or interrupted; inspect before retry.', array('status' => 423));
            try {
                wp_cache_flush();
                $route = '/wc/v3/' . $path;
                $current = rest_do_request(new WP_REST_Request('GET', $route));
                if ($current->is_error() || $current->get_status() !== 200)
                    return new WP_Error('m9_read_failed', 'Cannot verify target.', array('status' => 409));
                if (m9_local_snapshot(rest_get_server()->response_to_data($current, false)) !== m9_local_snapshot($expected))
                    return new WP_Error('m9_remote_changed', 'Snapshot changed; manual review required.', array('status' => 409));
                $parent = wc_get_product((int) $ids[1]);
                if (!$parent || $parent->get_status() !== 'draft' || !$parent->get_meta('_mi_tienda_test_operation'))
                    return new WP_Error('m9_draft_required', 'Marked local draft required.', array('status' => 403));
                $update = new WP_REST_Request('PUT', $route);
                $update->set_header('Content-Type', 'application/json');
                $update->set_body(wp_json_encode($payload));
                $GLOBALS['m9_local_guard_dispatch'] = true;
                try { return rest_do_request($update); }
                finally { unset($GLOBALS['m9_local_guard_dispatch']); }
            } finally {
                $wpdb->query($wpdb->prepare(
                    "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s",
                    'm9_conditional_write_lock', $token
                ));
            }
        }
    ));
});
