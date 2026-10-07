<?php
// Isolated transaction/WordPress fixtures, not a live Woo database.
define('ABSPATH','/');
class WP_Error {public $code; function __construct($c,$m='',$d=[]){$this->code=$c;} function get_error_code(){return $this->code;}}
function is_wp_error($v){return $v instanceof WP_Error;}
function m9_remote_test_origin(){return true;}
function add_action($n,$fn){$GLOBALS['actions'][$n]=$fn;}
function register_rest_route($ns,$path,$settings){$GLOBALS['routes'][$path]=$settings;}
function wp_json_encode($v){return json_encode($v);}
function maybe_unserialize($v){return unserialize($v);}
function get_current_user_id(){return $GLOBALS['owner'];}
function clean_post_cache($id){}
function wp_cache_delete($key,$group){}
function update_option($k,$v,$autoload=false){if($GLOBALS['receipt_write_failed'])return false;$GLOBALS['options'][$k]=$v;return true;}
function add_option($k,$v,$unused='',$autoload=false){if(isset($GLOBALS['options'][$k]))return false;$GLOBALS['options'][$k]=$v;return true;}
function update_post_meta($id,$key,$value){
 if($key!=='_thumbnail_id')throw new Exception('PROTECTED_META_WRITE');
 $GLOBALS['photo_writes'][]=[$id,$key,$value];
 foreach($GLOBALS['live']['variants'] as &$v){if($v['woo_variant_id']===$id){$v['own_image_id']=$value;$image=array_values(array_filter($GLOBALS['live']['images'],fn($i)=>$i['id']===$value))[0];$v['own_image']=['id'=>$value,'sha256'=>$image['sha256'],'alt'=>$image['alt']];}}unset($v);
 if($GLOBALS['fail_after_write'])throw new Exception('INJECTED_WRITE_FAILURE');
}
function m9_variant_photo_read($request){
 if($GLOBALS['readback_changed'] && count($GLOBALS['photo_writes']))$GLOBALS['live']['variants'][0]['price_cents']++;
 if(!$GLOBALS['isolation'])return new WP_Error('m9_isolation');
 if($request['id']!==$GLOBALS['live']['request_id'])return new WP_Error('m9_scope');
 $live=$GLOBALS['live'];unset($live['revision']);$live['revision']=hash('sha256',json_encode($live));return $live;
}
class FakeDB {
 public $posts='posts';public $postmeta='postmeta';public $options='options';public $snapshot=null;
 function prepare($q,...$args){return json_encode([$q,$args]);}
 function get_var($q){[$sql,$args]=json_decode($q,true);if(str_contains($sql,'SELECT ENGINE'))return $GLOBALS['engine'];if(str_contains($sql,'option_value'))return isset($GLOBALS['options'][$args[0]])?serialize($GLOBALS['options'][$args[0]]):null;throw new Exception('UNEXPECTED_QUERY');}
 function query($q){
  if($q==='START TRANSACTION'){$this->snapshot=[$GLOBALS['options'],$GLOBALS['live']];if($GLOBALS['concurrent'])$GLOBALS['live']['gallery_revision']=str_repeat('c',64);return 1;}
  if($q==='ROLLBACK'){if($this->snapshot!==null){[$GLOBALS['options'],$GLOBALS['live']]=$this->snapshot;$this->snapshot=null;}return 1;}
  if($q==='COMMIT'){if($GLOBALS['commit_not_applied'])return false;$this->snapshot=null;return $GLOBALS['commit_unknown']?false:1;}
  if($GLOBALS['lock_failed'])return false;
  return 1;
 }
}
function fixture($second=false){
 $GLOBALS['wpdb']=new FakeDB();$GLOBALS['options']=[];$GLOBALS['owner']=2;$GLOBALS['engine']='InnoDB';$GLOBALS['isolation']=true;
 $GLOBALS['receipt_write_failed']=false;$GLOBALS['readback_changed']=false;$GLOBALS['photo_writes']=[];$GLOBALS['fail_after_write']=false;$GLOBALS['concurrent']=false;$GLOBALS['commit_unknown']=false;$GLOBALS['commit_not_applied']=false;$GLOBALS['lock_failed']=false;
 $parent=$second?'ba239bba-7691-43cc-9c76-8768a1af9f21':'97c82026-b3cc-4c60-8f22-13d7c00fb33a';
 $scope=m9_variant_photo_write_scope($parent);$codes=$scope['codes'];
 $GLOBALS['live']=['protocol'=>'m9-remote-variant-photo-read-1','origin'=>'https://salmon-nightingale-251188.hostingersite.com','request_id'=>$parent,'product_id'=>'14f3af61-18f0-4adb-b1d8-29b447ae9cdb','woo_product_id'=>25,'gallery_revision'=>str_repeat('a',64),'images'=>[['id'=>31,'sha256'=>$scope['sha'],'alt'=>'']],'variants'=>[],'complete'=>true,'write_enabled'=>false];
 $p=['protocol'=>'m9-remote-variant-photo-write-1','update_id'=>'11111111-1111-4111-8111-111111111111','parent_id'=>$parent,'expected_revision'=>'','gallery_revision'=>str_repeat('a',64),'assignments'=>[]];
 foreach($codes as $i=>$code){$v=['variant_id'=>'33333333-3333-4333-8333-33333333333'.$i,'barcode'=>$code,'woo_variant_id'=>26+$i,'price_cents'=>$second?89000:82000,'attributes'=>['TALLA'=>(string)$i],'own_image_id'=>0,'own_image'=>null];$GLOBALS['live']['variants'][]=$v;$absent=$code==='10324';$p['assignments'][]=['variant_id'=>$v['variant_id'],'barcode'=>$code,'woo_variant_id'=>$v['woo_variant_id'],'image_id'=>$absent?0:31,'sha256'=>$absent?null:$scope['sha'],'alt'=>$absent?null:''];}
 $p['expected_revision']=m9_variant_photo_read(['id'=>$parent])['revision'];return $p;
}
class Request {public $p;function __construct($p){$this->p=$p;}function get_json_params(){return $this->p;}}
require '/variant-photo-write.php';$GLOBALS['actions']['rest_api_init']();$checks=[];
function ok($condition,$label){if(!$condition)throw new Exception($label);$GLOBALS['checks'][]=$label;}
function send($p){return m9_variant_photo_assign(new Request($p));}
function receipt($p){return m9_variant_photo_assignment_receipt(['update_id'=>$p['update_id']]);}
$p=fixture();$before=$GLOBALS['live'];$r=send($p);ok(!is_wp_error($r)&&$r['state']==='SUCCEEDED','five_assignments_atomic');
ok(count($GLOBALS['photo_writes'])===5,'exactly_five_thumbnail_writes');
ok($GLOBALS['live']['images']===$before['images']&&$GLOBALS['live']['gallery_revision']===$before['gallery_revision'],'gallery_preserved');
$strip=fn($vs)=>array_map(function($v){unset($v['own_image_id'],$v['own_image']);return $v;},$vs);
ok($strip($GLOBALS['live']['variants'])===$strip($before['variants']),'identity_attributes_prices_preserved');
$r=send($p);ok(!is_wp_error($r)&&count($GLOBALS['photo_writes'])===5,'same_request_no_repeat');
$changed=$p;$changed['gallery_revision']=str_repeat('d',64);ok(is_wp_error(send($changed)),'same_request_changed_packet');
$p=fixture(true);$r=send($p);ok(!is_wp_error($r)&&count($GLOBALS['photo_writes'])===4,'second_family_four_assignments');
ok($GLOBALS['live']['variants'][3]['own_image_id']===0,'10324_absence_retained');
foreach(['stock','approval','base64'] as $key){$p=fixture();$p[$key]=true;ok(is_wp_error(send($p))&&!$GLOBALS['photo_writes'],'extra_'.$key.'_rejected');}
foreach(['parent','barcode','uuid','price','sha','alt','partial','duplicate_child','duplicate_variant','fill_absence'] as $case){
 $p=fixture($case==='fill_absence');
 switch($case){case 'parent':$p['parent_id']='11111111-1111-4111-8111-111111111111';break;case 'barcode':$p['assignments'][0]['barcode']='010581';break;case 'uuid':$p['assignments'][0]['variant_id']='bad';break;case 'price':$p['assignments'][0]['price_cents']=1;break;case 'sha':$p['assignments'][0]['sha256']=str_repeat('e',64);break;case 'alt':$p['assignments'][0]['alt']='Changed';break;case 'partial':array_pop($p['assignments']);break;case 'duplicate_child':$p['assignments'][1]['woo_variant_id']=$p['assignments'][0]['woo_variant_id'];break;case 'duplicate_variant':$p['assignments'][1]['variant_id']=$p['assignments'][0]['variant_id'];break;case 'fill_absence':$p['assignments'][3]['image_id']=31;break;}
 ok(is_wp_error(send($p))&&!$GLOBALS['photo_writes'],'reject_'.$case);
}
$p=fixture();$GLOBALS['live']['variants'][0]['barcode']='different';ok(is_wp_error(send($p))&&!$GLOBALS['photo_writes'],'changed_live_identity');
$p=fixture();$GLOBALS['live']['variants'][0]['own_image_id']=999;ok(is_wp_error(send($p))&&!$GLOBALS['photo_writes'],'no_overwrite');
$p=fixture();$GLOBALS['live']['images'][]=['id'=>32,'sha256'=>$p['assignments'][0]['sha256'],'alt'=>''];ok(is_wp_error(send($p))&&!$GLOBALS['photo_writes'],'ambiguous_attachment');
$p=fixture();$GLOBALS['isolation']=false;ok(is_wp_error(send($p))&&!$GLOBALS['photo_writes'],'isolation_required');
$p=fixture();$GLOBALS['engine']='MyISAM';ok(is_wp_error(send($p))&&!$GLOBALS['photo_writes'],'transaction_engine_required');
$p=fixture();$GLOBALS['concurrent']=true;ok(is_wp_error(send($p))&&!$GLOBALS['photo_writes'],'recheck_under_locks');
$p=fixture();$GLOBALS['lock_failed']=true;ok(is_wp_error(send($p))&&!$GLOBALS['photo_writes'],'failed_lock');
$p=fixture();$before=$GLOBALS['live'];$GLOBALS['fail_after_write']=true;$r=send($p);ok(is_wp_error($r)&&$GLOBALS['live']===$before,'partial_write_rollback');
$GLOBALS['fail_after_write']=false;$writes=count($GLOBALS['photo_writes']);$r=send($p);ok(!is_wp_error($r)&&$r['state']==='REVIEW_REQUIRED'&&count($GLOBALS['photo_writes'])===$writes,'review_receipt_never_redispatched');
$p=fixture();$GLOBALS['commit_unknown']=true;ok(is_wp_error(send($p)),'commit_unknown_response');$GLOBALS['commit_unknown']=false;$r=receipt($p);ok(!is_wp_error($r)&&$r['state']==='SUCCEEDED'&&count($GLOBALS['photo_writes'])===5,'lost_commit_response_receipt');
$p=fixture();send($p);$key='m9_variant_photo_assignment_'.$p['update_id'];$GLOBALS['options'][$key]['state']='APPLYING';unset($GLOBALS['options'][$key]['after_revision']);$n=count($GLOBALS['photo_writes']);$r=receipt($p);ok(!is_wp_error($r)&&$r['reconciled_without_photo_write']&&count($GLOBALS['photo_writes'])===$n,'recover_applying_no_photo_write');
$p=fixture();send($p);$key='m9_variant_photo_assignment_'.$p['update_id'];$GLOBALS['options'][$key]['state']='APPLYING';$GLOBALS['live']['variants'][0]['price_cents']++;ok(is_wp_error(receipt($p)),'uncertain_changed_price_not_confirmed');
$p=fixture();send($p);$GLOBALS['owner']=3;ok(is_wp_error(receipt($p)),'receipt_owner_bound');
$p=fixture();ok(is_wp_error(receipt($p)),'missing_receipt_404');
ok(count($GLOBALS['routes'])===2&&$GLOBALS['routes']['/variant-photo-assignments']['methods']==='POST'&&$GLOBALS['routes']['/variant-photo-assignments']['permission_callback']==='m9_bridge_permission','scoped_routes');

$p=fixture();send($p);$n=count($GLOBALS['photo_writes']);$p['update_id']='22222222-2222-4222-8222-222222222222';$p['expected_revision']=m9_variant_photo_read(['id'=>$p['parent_id']])['revision'];$r=send($p);ok(!is_wp_error($r)&&count($GLOBALS['photo_writes'])===$n,'new_request_already_assigned_no_photo_write');
$p=fixture();$before=$GLOBALS['live'];$GLOBALS['receipt_write_failed']=true;ok(is_wp_error(send($p))&&$GLOBALS['live']===$before,'receipt_persistence_failure_rolls_back');$GLOBALS['receipt_write_failed']=false;ok(is_wp_error(receipt($p)),'unconfirmed_receipt_never_redispatched');
$p=fixture();$before=$GLOBALS['live'];$GLOBALS['readback_changed']=true;ok(is_wp_error(send($p))&&$GLOBALS['live']===$before,'protected_readback_change_rolls_back');

$p=fixture();$before=$GLOBALS['live'];$GLOBALS['commit_not_applied']=true;send($p);$GLOBALS['commit_not_applied']=false;$n=count($GLOBALS['photo_writes']);$r=send($p);ok(is_wp_error($r)&&$GLOBALS['live']===$before&&count($GLOBALS['photo_writes'])===$n,'commit_not_applied_requires_review_no_resend');
echo json_encode(['controls'=>count($checks),'checks'=>$checks,'network_requests'=>0,'real_database_writes'=>0]);
