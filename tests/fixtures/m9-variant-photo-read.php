<?php
// Isolated PHP execution with explicit WordPress/Woo fixtures. No network or real DB.
define('ABSPATH','/');
class WP_Error {public $code;function __construct($code,$message='',$data=[]){$this->code=$code;}}
function is_wp_error($v){return $v instanceof WP_Error;}
function m9_remote_test_origin(){return true;}
function add_action($name,$callback){$GLOBALS['actions'][$name]=$callback;}
function register_rest_route($namespace,$path,$settings){$GLOBALS['route']=[$namespace,$path,$settings];}
function m9_bridge_permission(){return false;}
function clean_post_cache($id){$GLOBALS['clean'][]=$id;}
function home_url(){return 'https://salmon-nightingale-251188.hostingersite.com';}
function wp_json_encode($value){return json_encode($value);}
function m9_bridge_isolation(){return $GLOBALS['guard'];}
function m9_bridge_receipt($request){return $GLOBALS['entry'];}
function m9_bridge_gallery($request){if(!empty($GLOBALS['changing'])){$GLOBALS['gallery']['revision']=str_repeat((string)(++$GLOBALS['sequence']),64);}return $GLOBALS['gallery'];}
function m9_family_identity($entry){return $GLOBALS['identity'];}
function wp_get_original_image_path($id){return $GLOBALS['photo_path'];}
function wp_get_original_image_url($id){return $GLOBALS['photo_url'];}
function get_post_meta($id,$key,$single){return 'Camisa';}
class Child {
 public $price='820.00'; public $own=0;
 function get_regular_price($mode){if($mode!=='edit')throw new Exception('VIEW_PRICE');return $this->price;}
 function get_image_id($mode){if($mode!=='edit')throw new Exception('INHERITED_IMAGE_READ');return $this->own;}
}
function wc_get_product($id){return $GLOBALS['children'][$id];}
function reset_fixture(){
 $GLOBALS['guard']=['origin'=>home_url(),'mail_blocked'=>true,'outbound_blocked'=>true,'purchase_blocked'=>true,'orders_blocked'=>true,'payment_gateways'=>0];
 $GLOBALS['entry']=['protocol'=>'m9-remote-family-1','state'=>'SUCCEEDED','request_id'=>'97c82026-b3cc-4c60-8f22-13d7c00fb33a','product_id'=>'product-fixture','remote_product_id'=>25,
 'verified'=>['variants'=>[['variant_id'=>'fixture-S','remote_variation_id'=>26,'barcode'=>'0001','price_cents'=>82000,'attributes'=>['TALLA'=>'S']],['variant_id'=>'fixture-M','remote_variation_id'=>27,'barcode'=>'0002','price_cents'=>82000,'attributes'=>['TALLA'=>'M']]]]];
 $GLOBALS['gallery']=['revision'=>str_repeat('a',64),'images'=>[['id'=>31,'sha256'=>hash('sha256','photo'),'alt'=>'Camisa']]];
 $GLOBALS['changing']=false;$GLOBALS['sequence']=0;$GLOBALS['identity']=true;$GLOBALS['children']=[26=>new Child(),27=>new Child()];$GLOBALS['clean']=[];
 $GLOBALS['photo_path']='/photo.jpg';file_put_contents('/photo.jpg','photo');$GLOBALS['photo_url']=home_url().'/wp-content/uploads/photo.jpg';
}
require '/variant-photo-read.php';
$GLOBALS['actions']['rest_api_init']();
$checks=[];
function ok($condition,$label){if(!$condition)throw new Exception($label);$GLOBALS['checks'][]=$label;}
$req=['id'=>'97c82026-b3cc-4c60-8f22-13d7c00fb33a'];
reset_fixture();$before=json_encode($GLOBALS['entry']);$r=m9_variant_photo_read($req);
ok(!is_wp_error($r) && $r['complete'] && !$r['write_enabled'],'complete_read_only');
ok($r['variants'][0]['own_image_id']===0 && $r['variants'][0]['own_image']===null,'no_inherited_photo');
ok($r['variants'][0]['barcode']==='0001','literal_barcode');
ok(json_encode($GLOBALS['entry'])===$before,'receipt_unchanged');
ok($GLOBALS['route'][2]['methods']==='GET' && $GLOBALS['route'][2]['permission_callback']==='m9_bridge_permission','get_permission_only');
reset_fixture();$GLOBALS['children'][26]->own=31;$r=m9_variant_photo_read($req);
ok($r['variants'][0]['own_image']['sha256']===hash('sha256','photo'),'own_bytes_read');
ok($r['variants'][1]['own_image_id']===0,'other_child_preserved');
ok(m9_variant_photo_pilot('ba239bba-7691-43cc-9c76-8768a1af9f21'),'second_pilot');
ok(is_wp_error(m9_variant_photo_read(['id'=>'11111111-1111-4111-8111-111111111111'])),'outside_pilot');
foreach(['mail_blocked','outbound_blocked','purchase_blocked','orders_blocked'] as $key){reset_fixture();$GLOBALS['guard'][$key]=false;ok(is_wp_error(m9_variant_photo_read($req)),'guard_'.$key);}
reset_fixture();$GLOBALS['guard']['payment_gateways']=1;ok(is_wp_error(m9_variant_photo_read($req)),'payments');
reset_fixture();$GLOBALS['guard']['origin']='https://vaquerosm.com';ok(is_wp_error(m9_variant_photo_read($req)),'production_origin');
reset_fixture();$GLOBALS['entry']['state']='DISPATCHING';ok(is_wp_error(m9_variant_photo_read($req)),'uncertain_receipt');
reset_fixture();$GLOBALS['identity']=false;ok(is_wp_error(m9_variant_photo_read($req)),'changed_identity');
reset_fixture();$GLOBALS['children'][26]->price='821.00';ok(is_wp_error(m9_variant_photo_read($req)),'changed_price');
reset_fixture();$GLOBALS['children'][26]->own=31;$GLOBALS['photo_url']='https://vaquerosm.com/a.jpg';ok(is_wp_error(m9_variant_photo_read($req)),'foreign_image');
reset_fixture();$GLOBALS['children'][26]->own=31;$GLOBALS['photo_path']='/missing.jpg';ok(is_wp_error(m9_variant_photo_read($req)),'missing_image');
reset_fixture();$GLOBALS['entry']['verified']['variants'][1]['barcode']='0001';ok(is_wp_error(m9_variant_photo_read($req)),'duplicate_barcode');
reset_fixture();$GLOBALS['gallery']=new WP_Error('changed');ok(is_wp_error(m9_variant_photo_read($req)),'gallery_changed');
reset_fixture();$GLOBALS['changing']=true;ok(is_wp_error(m9_variant_photo_read($req)),'concurrent_gallery_change');
echo json_encode(['controls'=>count($checks),'checks'=>$checks,'network_requests'=>0,'database_writes'=>0]);
