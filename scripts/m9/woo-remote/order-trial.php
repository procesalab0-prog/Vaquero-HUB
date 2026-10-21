<?php
// Native Woo orders, strictly synthetic; no public checkout or payment access.
if (!defined('ABSPATH') || !m9_remote_test_origin()) { return; }
function m9_order_trial_uuid($s) { return is_string($s) && preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/', $s); }
function m9_order_trial_option($key) {
    global $wpdb;
    $raw=$wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s",$key));
    return $raw===null ? null : maybe_unserialize($raw);
}
function m9_order_trial_lock($id, $run) {
    global $wpdb;
    $key='m9_order_trial_'.$id;
    if ((string)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 3)',$key))!=='1') {
        return new WP_Error('m9_order_busy','Ensayo en proceso; consulta su estado.',['status'=>409]);
    }
    try { return $run(); }
    catch(Throwable $e) { return new WP_Error('m9_order_review','Resultado incierto; conserva el UUID y consulta su recibo.',['status'=>409]); }
    finally { unset($GLOBALS['m9_order_trial_context']); $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)',$key)); }
}
function m9_order_trial_isolated() {
    $s=m9_bridge_isolation();
    return $s['mail_blocked']===true && $s['outbound_blocked']===true && $s['purchase_blocked']===true
        && $s['orders_blocked']===true && $s['payment_gateways']===0;
}
function m9_order_trial_product($parent,$code) {
    if (!in_array($parent,['97c82026-b3cc-4c60-8f22-13d7c00fb33a','ba239bba-7691-43cc-9c76-8768a1af9f21'],true)) {
        throw new Exception('TRIAL_FAMILY_ONLY');
    }
    $entry=m9_bridge_receipt(['id'=>$parent]);
    if (is_wp_error($entry) || ($entry['state']??'')!=='SUCCEEDED' || !m9_family_identity($entry)) { throw new Exception('TRIAL_PARENT_CHANGED'); }
    foreach($entry['verified']['variants'] as $v) {
        if ($v['barcode']!==$code) { continue; }
        $child=wc_get_product((int)$v['remote_variation_id']);
        if (!$child || $child->get_sku('edit')!==$code || $child->get_status()!=='draft'
            || (int)round((float)$child->get_regular_price('edit')*100)!==$v['price_cents']) { throw new Exception('TRIAL_VARIANT_CHANGED'); }
        return ['variant'=>$v,'product'=>$child,'parent'=>$entry];
    }
    throw new Exception('TRIAL_CODE_NOT_BOUND');
}
function m9_order_trial_snapshot($entry) {
    if ((int)$entry['owner']!==get_current_user_id()) { throw new Exception('TRIAL_OWNER'); }
    $bound=m9_order_trial_product($entry['parent_id'],$entry['barcode']);
    $order=wc_get_order((int)($entry['order_id']??0));
    if (!$order || $order->get_type()!=='shop_order' || $order->get_created_via()!=='m9_synthetic_trial'
        || $order->get_meta('_m9_order_trial_request')!==$entry['trial_id']
        || (int)$order->get_meta('_m9_order_trial_owner')!==get_current_user_id()
        || $order->get_customer_id()!==0 || $order->get_currency()!=='MXN') { throw new Exception('TRIAL_ORDER_IDENTITY'); }
    $items=array_values($order->get_items('line_item'));
    if (count($items)!==1) { throw new Exception('TRIAL_LINES_CHANGED'); }
    $item=$items[0]; $v=$bound['variant'];
    if ((int)$item->get_product_id()!==(int)$bound['parent']['remote_product_id']
        || (int)$item->get_variation_id()!==(int)$v['remote_variation_id']
        || (int)$item->get_quantity()!==$entry['quantity']
        || $item->get_meta('_m9_literal_barcode')!==$entry['barcode']
        || (int)round((float)$item->get_total()*100)!==$v['price_cents']*$entry['quantity']
        || (int)round((float)$order->get_total()*100)!==$v['price_cents']*$entry['quantity']) { throw new Exception('TRIAL_LINE_IDENTITY'); }
    $last=end($entry['steps']);
    if (!$last || $order->get_status()!==$last['status']) { throw new Exception('TRIAL_ORDER_CHANGED'); }
    return ['protocol'=>'m9-remote-order-trial-1','origin'=>rtrim(home_url(),'/'),'trial_id'=>$entry['trial_id'],
        'parent_id'=>$entry['parent_id'],'owner'=>(int)$entry['owner'],'order_id'=>(int)$order->get_id(),
        'version'=>(int)$entry['version'],'status'=>$order->get_status(),'line_id'=>(int)$item->get_id(),
        'woo_product_id'=>(int)$bound['parent']['remote_product_id'],'woo_variation_id'=>(int)$v['remote_variation_id'],
        'variant_id'=>$v['variant_id'],'barcode'=>$v['barcode'],'quantity'=>$entry['quantity'],'unit_price_cents'=>$v['price_cents'],
        'steps'=>$entry['steps'],'synthetic'=>true,'payment_executed'=>false,'shipping_executed'=>false];
}
function m9_order_trial_read($request) {
    $id=$request['id'];
    if (!m9_order_trial_uuid($id) || !m9_order_trial_isolated()) { return new WP_Error('m9_order_scope','Ensayo no disponible.',['status'=>403]); }
    $entry=m9_order_trial_option('m9_order_trial_'.$id);
    if (!$entry || (int)$entry['owner']!==get_current_user_id()) { return new WP_Error('m9_order_not_found','Sin recibo del ensayo.',['status'=>404]); }
    if (($entry['state']??'')!=='SUCCEEDED') { return new WP_Error('m9_order_uncertain','Guardado incierto; requiere revisión, no crear otra solicitud.',['status'=>409]); }
    try { return m9_order_trial_snapshot($entry); }
    catch(Throwable $e) { return new WP_Error('m9_order_changed','El pedido o catálogo cambió; requiere revisión.',['status'=>409]); }
}
function m9_order_trial_create($request) {
    $p=$request->get_json_params();$keys=['protocol','trial_id','parent_id','barcode','quantity'];
    if (!is_array($p)||count($p)!==count($keys)||array_diff(array_keys($p),$keys)
        || ($p['protocol']??'')!=='m9-remote-order-trial-1' || !m9_order_trial_uuid($p['trial_id']??null)
        || !m9_order_trial_uuid($p['parent_id']??null) || !is_string($p['barcode']??null)
        || !is_int($p['quantity']??null) || $p['quantity']<1 || $p['quantity']>3 || !m9_order_trial_isolated()) {
        return new WP_Error('m9_order_invalid','Solicitud sintética inválida.',['status'=>400]);
    }
    return m9_order_trial_lock($p['trial_id'],function()use($p){
        $key='m9_order_trial_'.$p['trial_id'];$old=m9_order_trial_option($key);$fingerprint=hash('sha256',wp_json_encode($p));
        if ($old) {
            if ((int)$old['owner']!==get_current_user_id()||$old['fingerprint']!==$fingerprint) { throw new Exception('TRIAL_CONFLICT'); }
            return m9_order_trial_read(['id'=>$p['trial_id']]);
        }
        $bound=m9_order_trial_product($p['parent_id'],$p['barcode']);
        $entry=['trial_id'=>$p['trial_id'],'parent_id'=>$p['parent_id'],'barcode'=>$p['barcode'],'quantity'=>$p['quantity'],
            'fingerprint'=>$fingerprint,'owner'=>get_current_user_id(),'state'=>'DISPATCHING','version'=>0,'steps'=>[]];
        if (!add_option($key,$entry,'',false)) { throw new Exception('TRIAL_ALREADY_CLAIMED'); }
        $order=new WC_Order();
        $order->set_created_via('m9_synthetic_trial');$order->set_customer_id(0);$order->set_currency('MXN');
        $order->set_status('pending');$order->set_payment_method('m9_synthetic_no_payment');
        $order->update_meta_data('_m9_order_trial_request',$p['trial_id']);$order->update_meta_data('_m9_order_trial_owner',get_current_user_id());
        $order->update_meta_data('_m9_synthetic_order',true);
        $GLOBALS['m9_order_trial_context']=['trial_id'=>$p['trial_id'],'order_id'=>0];
        $order->save();
        $entry['order_id']=$order->get_id();
        if (!update_option($key,$entry,false)) { throw new Exception('TRIAL_ID_NOT_RECORDED'); }
        $GLOBALS['m9_order_trial_context']['order_id']=$order->get_id();
        $item=new WC_Order_Item_Product();$item->set_product($bound['product']);$item->set_quantity($p['quantity']);
        $amount=wc_format_decimal($bound['variant']['price_cents']*$p['quantity']/100,2);
        $item->set_subtotal($amount);$item->set_total($amount);$item->add_meta_data('_m9_literal_barcode',$p['barcode'],true);
        $order->add_item($item);$order->set_total($amount);$order->save();
        $entry['steps'][]=['phase'=>'CREATE','status'=>'pending','version'=>1];$entry['version']=1;$entry['state']='SUCCEEDED';
        if (!update_option($key,$entry,false)) { throw new Exception('TRIAL_RECEIPT_NOT_RECORDED'); }
        return m9_order_trial_snapshot($entry);
    });
}
function m9_order_trial_step($request) {
    $id=$request['id'];$p=$request->get_json_params();$keys=['protocol','operation_id','expected_version','phase'];
    if (!m9_order_trial_uuid($id)||!is_array($p)||count($p)!==count($keys)||array_diff(array_keys($p),$keys)
        || ($p['protocol']??'')!=='m9-remote-order-trial-1'||!m9_order_trial_uuid($p['operation_id']??null)
        || !is_int($p['expected_version']??null)||!in_array($p['phase']??null,['PROCESS','CANCEL'],true)||!m9_order_trial_isolated()) {
        return new WP_Error('m9_order_step_invalid','Paso inválido.',['status'=>400]);
    }
    return m9_order_trial_lock($id,function()use($id,$p){
        $entry=m9_order_trial_option('m9_order_trial_'.$id);
        if (!$entry || (int)$entry['owner']!==get_current_user_id() || ($entry['state']??'')!=='SUCCEEDED') { throw new Exception('TRIAL_NOT_READY'); }
        $snapshot=m9_order_trial_snapshot($entry);$stepkey='m9_order_step_'.$p['operation_id'];$old=m9_order_trial_option($stepkey);
        $hash=hash('sha256',wp_json_encode(['trial_id'=>$id,'packet'=>$p]));
        if ($old) {
            if (($old['hash']??'')!==$hash || ($old['owner']??0)!==get_current_user_id() || ($old['state']??'')!=='SUCCEEDED') { throw new Exception('TRIAL_STEP_UNCERTAIN'); }
            return $snapshot;
        }
        $target=$p['phase']==='PROCESS'?'processing':'cancelled';$expected=$p['phase']==='PROCESS'?'pending':'processing';
        if ($entry['version']!==$p['expected_version'] || $snapshot['status']!==$expected) { throw new Exception('TRIAL_VERSION_CHANGED'); }
        $intent=['hash'=>$hash,'owner'=>get_current_user_id(),'state'=>'DISPATCHING'];
        if (!add_option($stepkey,$intent,'',false)) { throw new Exception('TRIAL_STEP_CLAIMED'); }
        $GLOBALS['m9_order_trial_context']=['trial_id'=>$id,'order_id'=>$entry['order_id']];
        $order=wc_get_order($entry['order_id']);$order->update_status($target,'ENSAYO M9 — Sin cobro ni envío real',false);
        $entry['version']++;$entry['steps'][]=['phase'=>$p['phase'],'status'=>$target,'version'=>$entry['version']];
        if (!update_option('m9_order_trial_'.$id,$entry,false)) { throw new Exception('TRIAL_STEP_NOT_RECORDED'); }
        $intent['state']='SUCCEEDED';if (!update_option($stepkey,$intent,false)) { throw new Exception('TRIAL_STEP_RECEIPT_UNCERTAIN'); }
        return m9_order_trial_snapshot($entry);
    });
}
// Automatic Woo stock accounting must never compete with the central QA book.
foreach(['woocommerce_can_reduce_order_stock','woocommerce_can_restore_order_stock'] as $hook) {
    add_filter($hook,function($allowed,$order){return $order && $order->get_created_via()==='m9_synthetic_trial' ? false : $allowed;},PHP_INT_MAX,2);
}
add_action('rest_api_init',function(){
    register_rest_route('m9-test/v1','/order-trials',['methods'=>'POST','permission_callback'=>'m9_bridge_permission','callback'=>'m9_order_trial_create']);
    register_rest_route('m9-test/v1','/order-trials/(?P<id>[0-9a-f-]{36})',['methods'=>'GET','permission_callback'=>'m9_bridge_permission','callback'=>'m9_order_trial_read']);
    register_rest_route('m9-test/v1','/order-trials/(?P<id>[0-9a-f-]{36})/step',['methods'=>'POST','permission_callback'=>'m9_bridge_permission','callback'=>'m9_order_trial_step']);
});
