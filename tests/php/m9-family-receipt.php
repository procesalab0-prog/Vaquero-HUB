<?php
// Run: php tests/php/m9-family-receipt.php (PHP 8 + mbstring).
// Exercises durable receipt keys after attribute iteration and interruption.
define('ABSPATH', '/');
$options=[];
function m9_remote_test_origin(){return true;}
function add_action(...$args){}
function sanitize_text_field($v){return trim(strip_tags($v));}
function wp_json_encode($v){return json_encode($v);}
function m9_bridge_validate($p){return ['image bytes','image/png'];}
function m9_bridge_isolation(){return ['mail_blocked'=>true,'outbound_blocked'=>true,'purchase_blocked'=>true,'orders_blocked'=>true,'payment_gateways'=>0];}
function get_current_user_id(){return 2;}
function get_option($k){global $options;return $options[$k]??false;}
function add_option($k,$v,...$args){global $options;if(isset($options[$k]))return false;$options[$k]=$v;return true;}
function update_option($k,$v,...$args){global $options;$options[$k]=$v;return true;}
function wc_get_product_id_by_sku($code){return 0;}
class WP_Error {function __construct(public $code, public $message, public $data=[]){}}
class WC_Product_Attribute {function __call($n,$a){}}
class WC_Product_Variable {function __call($n,$a){} function save(){return 77;}}
class WC_Product_Variation {function __construct(){throw new Exception('SIMULATED_INTERRUPTION');}}
class Request {function __construct(public $packet){} function get_json_params(){return $this->packet;}}
require __DIR__.'/../../scripts/m9/woo-remote/family-write.php';
$id='11111111-1111-4111-8111-111111111111';
$p=['protocol'=>'m9-remote-family-1','request_id'=>$id,'product_id'=>$id,'revision'=>1,'name'=>'Test','description'=>'Test','short_description'=>'BASE','barcode'=>'M9-P-'.$id,'categories'=>[],'descriptive_attributes'=>[],'images'=>[['base64'=>'bytes','sha256'=>'hash','alt'=>'']], 'variants'=>[
 ['variant_id'=>$id,'barcode'=>'0001','price_cents'=>100,'attributes'=>['TALLA'=>'S']],
 ['variant_id'=>'22222222-2222-4222-8222-222222222222','barcode'=>'0002','price_cents'=>100,'attributes'=>['TALLA'=>'M']]]];
foreach(['TALLA','COLOR','LARGO'] as $attribute){
 $options=[];$p['variants'][0]['attributes']=[$attribute=>'S'];$p['variants'][1]['attributes']=[$attribute=>'M'];
 $result=m9_family_create(new Request($p));$key='m9_remote_job_'.$id;
 if(!($result instanceof WP_Error) || ($options[$key]['remote_product_id']??0)!==77 || ($options[$key]['state']??'')!=='REVIEW_REQUIRED' || isset($options[$attribute])){throw new Exception('RECEIPT_KEY_CORRUPTED: '.$attribute);}
 if(m9_family_create(new Request($p))['remote_product_id']!==77){throw new Exception('PARTIAL_REPLAYED');}
}
echo "PASS: request receipt survives each attribute and interrupted creation; retry preserves parent.\n";
