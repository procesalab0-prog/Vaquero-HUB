<?php
// Synthetic availability transport only. No checkout, customer, source counts or live sync.
if (!defined('ABSPATH') || !m9_remote_test_origin()) { return; }
function m9_availability_fields($p) {
    return ['manage_stock'=>$p->get_manage_stock('edit'),'quantity'=>$p->get_stock_quantity('edit'),
        'status'=>$p->get_stock_status('edit'),'backorders'=>$p->get_backorders('edit')];
}
function m9_availability_restore($product,$s) {
    $product->set_manage_stock($s['manage_stock']);$product->set_stock_quantity($s['quantity']);
    $product->set_stock_status($s['status']);$product->set_backorders($s['backorders']);$product->save();
}
function m9_availability_read($request) {
    if (!m9_order_trial_uuid($request['id']) || !m9_order_trial_isolated()) { return new WP_Error('m9_availability_scope','Ensayo no disponible.',['status'=>403]); }
    $r=m9_order_trial_option('m9_availability_trial_'.$request['id']);
    if (!$r || $r['owner']!==get_current_user_id()) { return new WP_Error('m9_availability_missing','Sin recibo.',['status'=>404]); }
    if ($r['state']!=='SUCCEEDED') { return new WP_Error('m9_availability_review','Restauración incierta; requiere revisión.',['status'=>409]); }
    return $r['receipt'];
}
function m9_availability_trial($request) {
    $p=$request->get_json_params();
    if (!is_array($p)||count($p)!==3||array_diff(array_keys($p),['protocol','trial_id','quantities'])
        ||($p['protocol']??'')!=='m9-remote-availability-trial-1'||!m9_order_trial_uuid($p['trial_id']??null)
        ||!is_array($p['quantities']??null)||!m9_order_trial_isolated()) { return new WP_Error('m9_availability_invalid','Solicitud inválida.',['status'=>400]); }
    $order=m9_order_trial_read(['id'=>$p['trial_id']]);
    if (is_wp_error($order)||$order['status']!=='cancelled'||$order['synthetic']!==true) { return new WP_Error('m9_availability_order','Pedido sintético cancelado requerido.',['status'=>409]); }
    if ($p['quantities']!==[$order['quantity']+1,1,0,1,1,$order['quantity']+1]) { return new WP_Error('m9_availability_trace','Traza sintética no verificada.',['status'=>400]); }
    // Serialize all variants in a family: Woo can recalculate parent stock as a side effect.
    return m9_order_trial_lock($order['parent_id'],function()use($p,$order){
        $key='m9_availability_trial_'.$p['trial_id'];$hash=hash('sha256',wp_json_encode($p));
        $prior=m9_order_trial_option($key);
        if ($prior) {
            if ($prior['owner']!==get_current_user_id()||$prior['hash']!==$hash) { throw new Exception('AVAILABILITY_REQUEST_CHANGED'); }
            return m9_availability_read(['id'=>$p['trial_id']]);
        }
        $bound=m9_order_trial_product($order['parent_id'],$order['barcode']);
        $child=$bound['product'];$parent=wc_get_product($order['woo_product_id']);
        if (!$parent || $parent->get_status()!=='draft') { throw new Exception('AVAILABILITY_PARENT_CHANGED'); }
        $before=['variation'=>m9_availability_fields($child),'parent'=>m9_availability_fields($parent)];
        if ($before['variation']['manage_stock']!==false || $before['variation']['quantity']!==null) {
            throw new Exception('AVAILABILITY_NONEMPTY_REMOTE_STOCK');
        }
        $entry=['owner'=>get_current_user_id(),'hash'=>$hash,'state'=>'DISPATCHING','before'=>$before,'quantities'=>$p['quantities']];
        if (!add_option($key,$entry,'',false)) { throw new Exception('AVAILABILITY_ALREADY_CLAIMED'); }
        $trace=[];$completed=false;
        try {
            foreach($p['quantities'] as $q) {
                $child=wc_get_product($order['woo_variation_id']);
                $child->set_manage_stock(true);$child->set_stock_quantity($q);$child->set_stock_status($q>0?'instock':'outofstock');$child->set_backorders('no');$child->save();
                $actual=m9_availability_fields(wc_get_product($order['woo_variation_id']));
                if ($actual!==['manage_stock'=>true,'quantity'=>$q,'status'=>$q>0?'instock':'outofstock','backorders'=>'no']) { throw new Exception('AVAILABILITY_READBACK_FAILED'); }
                $trace[]=$q;
            }
            $completed=true;
        } finally {
            // Reversal uses the exact semantic stock snapshots, not a guessed zero.
            try { m9_availability_restore(wc_get_product($order['woo_variation_id']),$before['variation']); }
            finally { m9_availability_restore(wc_get_product($order['woo_product_id']),$before['parent']); }
        }
        $after=['variation'=>m9_availability_fields(wc_get_product($order['woo_variation_id'])),'parent'=>m9_availability_fields(wc_get_product($order['woo_product_id']))];
        if (!$completed||$after!==$before||!m9_family_identity($bound['parent'])||!m9_order_trial_isolated()) { throw new Exception('AVAILABILITY_RESTORE_REVIEW'); }
        $receipt=['protocol'=>'m9-remote-availability-trial-1','origin'=>rtrim(home_url(),'/'),'trial_id'=>$p['trial_id'],
            'barcode'=>$order['barcode'],'woo_product_id'=>$order['woo_product_id'],'woo_variation_id'=>$order['woo_variation_id'],
            'quantities'=>$trace,'synthetic'=>true,'restored'=>true,'before'=>$before,'after'=>$after];
        $entry['state']='SUCCEEDED';$entry['receipt']=$receipt;
        if (!update_option($key,$entry,false)) { throw new Exception('AVAILABILITY_RECEIPT_UNCERTAIN'); }
        return $receipt;
    });
}
add_action('rest_api_init',function(){
    register_rest_route('m9-test/v1','/availability-trials',['methods'=>'POST','permission_callback'=>'m9_bridge_permission','callback'=>'m9_availability_trial']);
    register_rest_route('m9-test/v1','/availability-trials/(?P<id>[0-9a-f-]{36})',['methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_availability_read']);
});
