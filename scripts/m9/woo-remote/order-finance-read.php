<?php
// GET only. Native synthetic orders owned by the authenticated technical account.
if (!defined('ABSPATH') || !m9_remote_test_origin()) { return; }
function m9_finance_decimal($value) {
    $s=wc_format_decimal($value,2);
    if (!is_string($s) || !preg_match('/^(0|[1-9][0-9]{0,12})\.[0-9]{2}$/',$s)) { throw new Exception('FINANCE_DECIMAL_INVALID'); }
    return $s;
}
function m9_order_finance_read($request) {
    if (!m9_remote_test_origin() || !m9_bridge_permission()) { return new WP_Error('m9_finance_scope','Lectura no autorizada.',['status'=>403]); }
    $reference=m9_order_trial_read($request);
    if (is_wp_error($reference)) { return $reference; }
    try {
        $order=wc_get_order($reference['order_id']);
        $lines=[];
        foreach($order->get_items('line_item') as $item) {
            $lines[]=['line_id'=>(int)$item->get_id(),'subtotal'=>m9_finance_decimal($item->get_subtotal()),
                'total'=>m9_finance_decimal($item->get_total()),'subtotal_tax'=>m9_finance_decimal($item->get_subtotal_tax()),
                'total_tax'=>m9_finance_decimal($item->get_total_tax())];
        }
        $fee_total=0;
        foreach($order->get_items('fee') as $fee) { $fee_total+=(float)$fee->get_total(); }
        $paid_at=$order->get_date_paid('edit');
        return ['protocol'=>'m9-remote-order-finance-read-1','reference'=>$reference,'currency'=>$order->get_currency(),
            'money'=>['items_subtotal'=>m9_finance_decimal($order->get_subtotal()),'discount_total'=>m9_finance_decimal($order->get_discount_total('edit')),
                'shipping_total'=>m9_finance_decimal($order->get_shipping_total('edit')),'shipping_tax'=>m9_finance_decimal($order->get_shipping_tax('edit')),
                'cart_tax'=>m9_finance_decimal($order->get_cart_tax('edit')),'total_tax'=>m9_finance_decimal($order->get_total_tax('edit')),
                'fees_total'=>m9_finance_decimal($fee_total),'refunded_total'=>m9_finance_decimal($order->get_total_refunded()),
                'total'=>m9_finance_decimal($order->get_total('edit'))],
            'payment'=>['method'=>$order->get_payment_method('edit'),'transaction_id'=>$order->get_transaction_id('edit'),
                'paid_at'=>$paid_at ? $paid_at->date(DATE_ATOM) : null,'is_paid'=>$order->is_paid()],
            'lines'=>$lines,'counts'=>['coupons'=>count($order->get_items('coupon')),'shipping'=>count($order->get_items('shipping')),
                'fees'=>count($order->get_items('fee')),'refunds'=>count($order->get_refunds())]];
    } catch(Throwable $e) { return new WP_Error('m9_finance_read_review','No se pudo comprobar el pedido; no contabilizar.',['status'=>409]); }
}
add_action('rest_api_init',function(){
 register_rest_route('m9-test/v1','/order-trials/(?P<id>[0-9a-f-]{36})/finance',
  ['methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_order_finance_read']);
});
