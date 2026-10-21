-- Synthetic SQL protocol fixture. Never evidence of a live remote stock write.
begin;
set local statement_timeout='90s';
create temporary table availability_results(result jsonb) on commit drop;
create function pg_temp.fail_availability_event() returns trigger language plpgsql as $$
begin if current_setting('m9.fail_availability',true)='on' then raise exception 'QA_CAPTURE_FAILURE'; end if;return new;end $$;
create trigger m9_qa_capture_failure before insert on app.m9_availability_events for each row execute function pg_temp.fail_availability_event();
do $$
declare
 actor uuid:='2b5e4ba1-00f2-48c7-bbe0-273340629711';tid uuid:=gen_random_uuid();
 input jsonb; claim jsonb; snapshot jsonb; native jsonb; receipt jsonb; bad jsonb; got jsonb;
 n integer:=0; c text; caught boolean; wanted text;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 input:=jsonb_build_object('actor_id',actor,'id',tid,'parent_id','97c82026-b3cc-4c60-8f22-13d7c00fb33a');
 claim:=public.m9_connected_woo_trial('INIT',input);
 snapshot:=claim->'expected'||jsonb_build_object('protocol','m9-remote-order-trial-1','origin','https://salmon-nightingale-251188.hostingersite.com',
  'trial_id',tid,'order_id',900001001,'line_id',900001002,'version',3,'status','cancelled','synthetic',true,'payment_executed',false,'shipping_executed',false,
  'steps','[{"phase":"CREATE","status":"pending","version":1},{"phase":"PROCESS","status":"processing","version":2},{"phase":"CANCEL","status":"cancelled","version":3}]'::jsonb);
 input:=jsonb_build_object('actor_id',actor,'id',tid,'observed_at',clock_timestamp(),'snapshot',snapshot);
 perform set_config('m9.fail_availability','on',true);caught:=false;
 begin perform public.m9_connected_woo_trial('FINISH',input);
 exception when others then if sqlerrm<>'QA_CAPTURE_FAILURE' then raise; end if;caught:=true;end;
 if not caught or exists(select 1 from app.m9_availability_outbox) or exists(select 1 from app.m9_availability_events)
  or exists(select 1 from app.m9_woo_pilot_orders) then raise exception 'CAPTURE_FAILURE_NOT_ATOMIC'; end if;
 perform set_config('m9.fail_availability','off',true);
 native:=public.m9_connected_woo_trial('FINISH',input);
 if native->'availability_capture_rollback'<>'true'::jsonb or native->>'pos_inventory_operations'<>'2'
  or (select jsonb_agg(x->'available' order by (x->>'revision')::integer) from jsonb_array_elements(native->'availability_trace') x)
    is distinct from '[0,3,1,0,1,3,1,3]'::jsonb
  then raise exception 'CAPTURE_TRACE_WRONG'; end if;
 if exists(select 1 from app.m9_availability_outbox) or exists(select 1 from app.m9_availability_events)
  or exists(select 1 from app.m9_availability_control where enabled) then raise exception 'CAPTURE_WRITES_REMAIN'; end if;
 input:=jsonb_build_object('actor_id',actor,'id',tid);claim:=public.m9_connected_availability('INIT',input);
 if claim->>'dispatch'<>'true' or public.m9_connected_availability('INIT',input)->>'dispatch'<>'false'
  or claim->'packet'->'quantities'<>'[3,1,0,1,1,3]'::jsonb then raise exception 'AVAILABILITY_DISPATCH_WRONG'; end if;
 receipt:=claim->'packet'||jsonb_build_object('origin','https://salmon-nightingale-251188.hostingersite.com','barcode',snapshot->>'barcode',
  'woo_product_id',snapshot->'woo_product_id','woo_variation_id',snapshot->'woo_variation_id','synthetic',true,'restored',true,
  'before','{"variation":{"manage_stock":false,"quantity":null},"parent":{"manage_stock":false,"quantity":null}}'::jsonb,
  'after','{"variation":{"manage_stock":false,"quantity":null},"parent":{"manage_stock":false,"quantity":null}}'::jsonb);
 foreach c in array array['origin','barcode','variation','product','quantities','restored','synthetic','after','missing_before','actor','role','extra'] loop
  bad:=input||jsonb_build_object('receipt',receipt);wanted:='AVAILABILITY_RECEIPT_CHANGED';
  case c
   when 'origin' then bad:=jsonb_set(bad,'{receipt,origin}','"https://vaquerosm.com"');
   when 'barcode' then bad:=jsonb_set(bad,'{receipt,barcode}','"010582"');
   when 'variation' then bad:=jsonb_set(bad,'{receipt,woo_variation_id}','1');
   when 'product' then bad:=jsonb_set(bad,'{receipt,woo_product_id}','1');
   when 'quantities' then bad:=jsonb_set(bad,'{receipt,quantities}','[100]');
   when 'restored' then bad:=jsonb_set(bad,'{receipt,restored}','false');
   when 'synthetic' then bad:=jsonb_set(bad,'{receipt,synthetic}','false');
   when 'after' then bad:=jsonb_set(bad,'{receipt,after}','{}');
   when 'missing_before' then bad:=jsonb_set(bad,'{receipt}',receipt-'before');
   when 'actor' then bad:=jsonb_set(bad,'{actor_id}','"00000000-0000-0000-0000-000000000001"');wanted:='NOT_AUTHORIZED';
   when 'role' then perform set_config('request.jwt.claims','{"role":"authenticated"}',true);wanted:='M9_CONNECTED_SERVER_ONLY';
   when 'extra' then bad:=bad||'{"cost":0}';wanted:='AVAILABILITY_INPUT_INVALID';
  end case;
  caught:=false;begin perform public.m9_connected_availability('FINISH',bad);
  exception when others then if sqlerrm<>wanted then raise exception 'EXPECTED %, GOT %',wanted,sqlerrm;end if;caught:=true;end;
  if not caught then raise exception 'MISSING_REJECTION %',c;end if;n:=n+1;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 end loop;
 input:=input||jsonb_build_object('receipt',receipt);got:=public.m9_connected_availability('FINISH',input);
 if got->>'verified'<>'true' or public.m9_connected_availability('FINISH',input)<>got then raise exception 'AVAILABILITY_REPLAY_FAILED';end if;
 if has_function_privilege('authenticated','public.m9_connected_availability(text,jsonb)','EXECUTE') or
  has_function_privilege('anon','public.m9_connected_availability(text,jsonb)','EXECUTE') then raise exception 'AVAILABILITY_API_LEAK';end if;
 insert into availability_results values(jsonb_build_object('negative_checks',n,'capture_failure_atomic',true,'native_pos_inventory_operations',2,
  'capture_available_trace',native->'availability_trace','transport_checkpoints',claim->'packet'->'quantities','replay_verified',true,'native_stock_restored',true,'real_remote_write',false));
end $$;
select result from availability_results;
rollback;
