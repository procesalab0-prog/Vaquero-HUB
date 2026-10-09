<?php
/** Prototype restricted to the isolated laboratory. Never install in production. */
if (!defined('ABSPATH') || wp_get_environment_type() !== 'local' || home_url() !== 'http://127.0.0.1:9417') return;

function m9_display_only($product, $parent_lookup = null) {
    if (!$product instanceof WC_Product) return false;
    if ($product->get_meta('_m9_display_only') === 'yes') return true;
    if (!$product->is_type('variation') || !$product->get_parent_id()) return false;
    $parent = $parent_lookup ? $parent_lookup($product->get_parent_id()) : wc_get_product($product->get_parent_id());
    return $parent instanceof WC_Product && $parent->get_meta('_m9_display_only') === 'yes';
}
function m9_display_purchasable($allowed, $product) {
    return m9_display_only($product) ? false : $allowed;
}
function m9_display_validate($product) {
    if (m9_display_only($product)) throw new Exception('Este producto es sólo de exhibición. Contacta a la tienda para consultar disponibilidad.');
}
add_filter('woocommerce_is_purchasable', 'm9_display_purchasable', 50, 2);
add_filter('woocommerce_variation_is_purchasable', 'm9_display_purchasable', 50, 2);
add_filter('woocommerce_add_to_cart_validation', function ($allowed, $product_id, $quantity, $variation_id = 0) {
    if (m9_display_only(wc_get_product($variation_id ?: $product_id))) {
        wc_add_notice('Producto sólo de exhibición. Consulta disponibilidad con la tienda.', 'error');
        return false;
    }
    return $allowed;
}, 50, 4);
add_action('woocommerce_store_api_validate_add_to_cart', 'm9_display_validate', 50);
add_action('woocommerce_store_api_validate_cart_item', 'm9_display_validate', 50);
add_action('woocommerce_check_cart_items', function () {
    if (!WC()->cart) return;
    foreach (WC()->cart->get_cart() as $item) {
        if (m9_display_only($item['data'] ?? null)) {
            wc_add_notice('Retira el producto de exhibición del carrito para continuar.', 'error');
            break;
        }
    }
});


function m9_display_policy_version() { return "m9-display-only-1"; }
