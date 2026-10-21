<?php
// Isolated native-interface fixtures. No real WP DB, HTTP, orders or payments.
define('ABSPATH','/');
class WP_Error {public $code;function __construct($c,$m='',$data=[]){$this->code=$c;}function get_error_code(){return $this->code;}}
function is_wp_error($x){return $x instanceof WP_Error;}
function m9_remote_test_origin(){return $GLOBALS['origin'];}
function home_url(){return 'https://salmon-nightingale-251188.hostingersite.com';}
function get_current_user_id(){return $GLOBALS['owner'];}
function m9_bridge_permission(){return $GLOBALS['permission'];}
function wp_json_encode($x){return json_encode($x);}
function maybe_unserialize($x){return unserialize($x);}
function add_action($hook,$fn){$GLOBALS['actions'][$hook][]=$fn;}
function add_filter($hook,$fn,$priority=10,$argc=1){$GLOBALS['filters'][$hook][]=$fn;}
function apply_filters($hook,$value,...$args){foreach($GLOBALS['filters'][$hook]??[] as $fn)$value=$fn($value,...$args);return $value;}
function register_rest_route($ns,$route,$settings){$GLOBALS['routes'][$route]=$settings;}
function add_option($k,$v,$unused='',$autoload=false){if(isset($GLOBALS['options'][$k]))return false;$GLOBALS['options'][$k]=$v;return true;}
function update_option($k,$v,$autoload=false){if($GLOBALS['fail_receipt'])return false;if(($GLOBALS['options'][$k]??null)===$v)return false;$GLOBALS['options'][$k]=$v;return true;}
function wc_format_decimal($x,$places){return number_format((float)$x,$places,'.','');}
function m9_bridge_isolation(){return ['mail_blocked'=>$GLOBALS['isolation'],'outbound_blocked'=>true,'purchase_blocked'=>true,'orders_blocked'=>true,'payment_gateways'=>0];}
function m9_bridge_receipt($request){if($request['id']!==$GLOBALS['parent'] || $GLOBALS['owner']!==2)return new WP_Error('scope');return ['state'=>'SUCCEEDED','remote_product_id'=>25,'verified'=>['variants'=>[['barcode'=>'10582','price_cents'=>82000,'variant_id'=>'6a73351b-91d3-49d5-8064-0a052ccbf851','remote_variation_id'=>27]]]];}
function m9_family_identity($entry){return $GLOBALS['identity'];}
class FakeProduct {function get_sku($mode){return $GLOBALS['code'];}function get_status(){return 'draft';}function get_regular_price($mode){return '820.00';}}
function wc_get_product($id){return $id===27?new FakeProduct():false;}
class FakeDB {public $options='wp_options';function prepare($q,...$args){return json_encode([$q,$args]);}function get_var($q){[$query,$args]=json_decode($q,true);if(str_contains($query,'GET_LOCK'))return $GLOBALS['lock']?'1':'0';if(str_contains($query,'RELEASE_LOCK'))return '1';return isset($GLOBALS['options'][$args[0]])?serialize($GLOBALS['options'][$args[0]]):null;}}
class WC_Order_Item_Product {
 public $id=0,$pid=0,$vid=0,$q=0,$total=0,$meta=[];
 function set_product($p){$this->pid=25;$this->vid=27;}function set_quantity($q){$this->q=$q;}
 function set_subtotal($x){}function set_total($x){$this->total=$x;}function add_meta_data($k,$v,$unique){$this->meta[$k]=$v;}
 function get_product_id(){return $this->pid;}function get_variation_id(){return $this->vid;}function get_quantity(){return $this->q;}
 function get_total(){return $this->total;}function get_meta($k){return $this->meta[$k]??'';}function get_id(){return $this->id;}
}
class WC_Order {
 public $id=0,$via='',$customer=0,$currency='MXN',$status='pending',$meta=[],$items=[],$total=0;
 function get_type(){return 'shop_order';}function set_created_via($s){$this->via=$s;}function get_created_via(){return $this->via;}
 function set_customer_id($n){$this->customer=$n;}function get_customer_id(){return $this->customer;}
 function set_currency($s){$this->currency=$s;}function get_currency(){return $this->currency;}
 function set_status($s){$this->status=$s;}function get_status(){return $this->status;}function set_payment_method($s){}
 function update_meta_data($k,$v){$this->meta[$k]=$v;}function get_meta($k){return $this->meta[$k]??'';}function get_id(){return $this->id;}
 function add_item($i){$i->id=500+count($this->items);$this->items[$i->id]=$i;}function get_items($type){return $this->items;}
 function set_total($s){$this->total=$s;}function get_total(){return $this->total;}
 function save(){m9_test_block_order($this);if(!$this->id)$this->id=1000+count($GLOBALS['orders']);$GLOBALS['orders'][$this->id]=clone $this;return $this->id;}
 function update_status($s,$note,$manual){$this->status=$s;$this->save();if(apply_filters($s==='cancelled'?'woocommerce_can_restore_order_stock':'woocommerce_can_reduce_order_stock',true,$this))$GLOBALS['stock_changed']++;}
}
function wc_get_order($id){return isset($GLOBALS['orders'][$id])?clone $GLOBALS['orders'][$id]:false;}
class Request implements ArrayAccess {
 public $p,$id;function __construct($p,$id=null){$this->p=$p;$this->id=$id;}function get_json_params(){return $this->p;}
 function offsetExists($o):bool{return $o==='id';}function offsetGet($o):mixed{return $this->id;}function offsetSet($o,$v):void{}function offsetUnset($o):void{}
}
function setup_fixture(){
 $GLOBALS['wpdb']=new FakeDB();$GLOBALS['options']=[];$GLOBALS['orders']=[];$GLOBALS['owner']=2;$GLOBALS['permission']=true;$GLOBALS['origin']=true;
 $GLOBALS['isolation']=true;$GLOBALS['identity']=true;$GLOBALS['code']='10582';$GLOBALS['lock']=true;$GLOBALS['fail_receipt']=false;$GLOBALS['stock_changed']=0;
 $GLOBALS['parent']='97c82026-b3cc-4c60-8f22-13d7c00fb33a';
 return ['protocol'=>'m9-remote-order-trial-1','trial_id'=>'11111111-1111-4111-8111-111111111111','parent_id'=>$GLOBALS['parent'],'barcode'=>'10582','quantity'=>2];
}
setup_fixture();require '/guard.php';require '/order-trial.php';foreach($GLOBALS['actions']['rest_api_init'] as $fn)$fn();
$checks=[];function ok($v,$name){if(!$v)throw new Exception($name);$GLOBALS['checks'][]=$name;}
function create_trial($p){return m9_order_trial_create(new Request($p));}
function step_trial($p,$phase,$version,$op){return m9_order_trial_step(new Request(['protocol'=>'m9-remote-order-trial-1','operation_id'=>$op,'expected_version'=>$version,'phase'=>$phase],$p['trial_id']));}
$p=setup_fixture();$r=create_trial($p);ok(!is_wp_error($r)&&$r['version']===1&&$r['quantity']===2,'native_order_created');
ok(count($GLOBALS['orders'])===1&&$r['barcode']==='10582'&&$r['unit_price_cents']===82000,'one_order_exact_code_price');
ok($r['synthetic']&&!$r['payment_executed']&&!$r['shipping_executed'],'no_financial_or_shipping_claim');
ok(create_trial($p)['order_id']===$r['order_id']&&count($GLOBALS['orders'])===1,'create_replay_no_duplicate');
$wrong=$p;$wrong['quantity']=3;ok(is_wp_error(create_trial($wrong))&&count($GLOBALS['orders'])===1,'changed_request_conflict');
$process='22222222-2222-4222-8222-222222222222';$cancel='33333333-3333-4333-8333-333333333333';
ok(is_wp_error(step_trial($p,'CANCEL',2,$cancel)),'cancel_before_process_rejected');
$r=step_trial($p,'PROCESS',1,$process);ok(!is_wp_error($r)&&$r['status']==='processing'&&$r['version']===2,'process_once');
ok(step_trial($p,'PROCESS',1,$process)['version']===2,'step_replay_same_receipt');
$r=step_trial($p,'CANCEL',2,$cancel);ok(!is_wp_error($r)&&$r['status']==='cancelled'&&$r['version']===3,'cancel_once');
ok(step_trial($p,'PROCESS',1,$process)['version']===3&&count($GLOBALS['orders'])===1,'old_step_does_not_reopen');
ok($GLOBALS['stock_changed']===0,'native_woo_stock_hooks_blocked');
ok(!isset($GLOBALS['m9_order_trial_context']),'write_exception_context_cleared');
$GLOBALS['owner']=9;ok(is_wp_error(m9_order_trial_read(['id'=>$p['trial_id']])),'other_owner_no_read');
foreach(['qty_zero','qty_fraction','qty_string','extra_field','outside_family','unknown_code','bad_uuid','isolation','identity','lock'] as $case){
 $p=setup_fixture();switch($case){case 'qty_zero':$p['quantity']=0;break;case 'qty_fraction':$p['quantity']=1.5;break;case 'qty_string':$p['quantity']='2';break;case 'extra_field':$p['stock']=100;break;case 'outside_family':$p['parent_id']='44444444-4444-4444-8444-444444444444';break;case 'unknown_code':$p['barcode']='010582';break;case 'bad_uuid':$p['trial_id']='bad';break;case 'isolation':$GLOBALS['isolation']=false;break;case 'identity':$GLOBALS['identity']=false;break;case 'lock':$GLOBALS['lock']=false;break;}
 ok(is_wp_error(create_trial($p))&&count($GLOBALS['orders'])===0,'reject_'.$case.'_before_order');
}
$p=setup_fixture();$GLOBALS['fail_receipt']=true;$r=create_trial($p);ok(is_wp_error($r)&&count($GLOBALS['orders'])===1,'uncertain_creation_recorded');
$GLOBALS['fail_receipt']=false;ok(is_wp_error(create_trial($p))&&count($GLOBALS['orders'])===1,'uncertain_creation_never_recreated');
ok(is_wp_error(m9_order_trial_read(['id'=>$p['trial_id']])),'uncertain_receipt_not_success');
$p=setup_fixture();create_trial($p);$id=array_key_first($GLOBALS['orders']);$GLOBALS['orders'][$id]->total=1;
ok(is_wp_error(m9_order_trial_read(['id'=>$p['trial_id']])),'changed_native_total_rejected');
$p=setup_fixture();$o=new WC_Order();$caught=false;try{$o->save();}catch(Throwable $e){$caught=true;}ok($caught&&!$GLOBALS['orders'],'ordinary_order_still_blocked');
$o->set_created_via('m9_synthetic_trial');$o->update_meta_data('_m9_order_trial_request',$p['trial_id']);$o->update_meta_data('_m9_order_trial_owner',2);
$GLOBALS['m9_order_trial_context']=['trial_id'=>$p['trial_id'],'order_id'=>0];$GLOBALS['permission']=false;
$caught=false;try{$o->save();}catch(Throwable $e){$caught=true;}ok($caught,'write_exception_requires_scoped_auth');unset($GLOBALS['m9_order_trial_context']);
foreach($GLOBALS['routes'] as $route=>$settings)ok($settings['permission_callback']==='m9_bridge_permission','route_permission_'.$route);
echo json_encode(['controls'=>count($checks),'checks'=>$checks,'scope'=>'ISOLATED_PHP_FIXTURES_NOT_LIVE_WOO','network_requests'=>0,'real_database_writes'=>0]);
