-- Maintenance synthetic protocol fixture only; NOT evidence of a remote order.
begin;
set local statement_timeout='90s';
set local lock_timeout='5s';
create temporary table connected_result(result jsonb) on commit drop;
do $$
declare
 tid uuid:=gen_random_uuid(); actor uuid:='2b5e4ba1-00f2-48c7-bbe0-273340629711';
 parent uuid:='97c82026-b3cc-4c60-8f22-13d7c00fb33a';
 input jsonb; queued jsonb; s jsonb; done jsonb; again jsonb; bad jsonb;
 n integer:=0; role_name text; case_name text; caught boolean; target_message text;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 input:=jsonb_build_object('id',tid,'parent_id',parent,'actor_id',actor);
 queued:=public.m9_connected_woo_trial('INIT',input);
 if queued->>'dispatch'<>'true' then raise exception 'INITIAL_DISPATCH_MISSING'; end if;
 if public.m9_connected_woo_trial('INIT',input)->>'dispatch'<>'false' then raise exception 'DISPATCH_REPEATED'; end if;
 if public.m9_connected_woo_trial('INIT',jsonb_set(input,'{parent_id}','"ba239bba-7691-43cc-9c76-8768a1af9f21"')) is null then raise exception 'MISSING_RESULT'; end if;
exception when others then
 -- This nested DO is deliberately not used to consume a positive assertion.
 if sqlerrm<>'TRIAL_REQUEST_CHANGED' then raise; end if;
 insert into connected_result values('{"phase":"changed_request_rejected"}'::jsonb);
end $$;
-- The preceding DO subtransaction reverted the attempted request and its event.
do $$
declare
 tid uuid:=gen_random_uuid(); actor uuid:='2b5e4ba1-00f2-48c7-bbe0-273340629711';
 parent uuid:='97c82026-b3cc-4c60-8f22-13d7c00fb33a';
 input jsonb; queued jsonb; s jsonb; done jsonb; again jsonb; bad jsonb;
 n integer:=0; role_name text; case_name text; caught boolean; target_message text;
 stock_before jsonb; stock_after jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 input:=jsonb_build_object('id',tid,'parent_id',parent,'actor_id',actor);
 queued:=public.m9_connected_woo_trial('INIT',input);
 s:=queued->'expected'||jsonb_build_object('protocol','m9-remote-order-trial-1',
  'origin','https://salmon-nightingale-251188.hostingersite.com','trial_id',tid,'order_id',900000981,'line_id',900000982,
  'version',3,'status','cancelled','synthetic',true,'payment_executed',false,'shipping_executed',false,
  'steps','[{"phase":"CREATE","status":"pending","version":1},{"phase":"PROCESS","status":"processing","version":2},{"phase":"CANCEL","status":"cancelled","version":3}]'::jsonb);
 input:=jsonb_build_object('id',tid,'actor_id',actor,'snapshot',s,'observed_at',clock_timestamp());
 select to_jsonb(i) into stock_before from public.inventory_by_location i where variant_id=(s->>'variant_id')::uuid and location_id='467765fe-d18e-43bb-be68-326adbf05ce1';
 foreach case_name in array array['origin','barcode','variation','price','money','status','journal','stale','future','wrong_actor','server_role','quantity','missing_id','extra_init'] loop
  bad:=input;target_message:='TRIAL_SNAPSHOT_IDENTITY';
  case case_name
   when 'origin' then bad:=jsonb_set(bad,'{snapshot,origin}','"https://vaquerosm.com"');
   when 'barcode' then bad:=jsonb_set(bad,'{snapshot,barcode}','"010582"');
   when 'variation' then bad:=jsonb_set(bad,'{snapshot,woo_variation_id}','9999');
   when 'price' then bad:=jsonb_set(bad,'{snapshot,unit_price_cents}','0');
   when 'money' then bad:=jsonb_set(bad,'{snapshot,payment_executed}','true');
   when 'status' then bad:=jsonb_set(bad,'{snapshot,status}','"processing"');
   when 'journal' then bad:=jsonb_set(bad,'{snapshot,steps}','[]');
   when 'quantity' then bad:=jsonb_set(bad,'{snapshot,quantity}','3');
   when 'missing_id' then bad:=jsonb_set(bad,'{snapshot}',s-'line_id');
   when 'stale' then bad:=jsonb_set(bad,'{observed_at}',to_jsonb(clock_timestamp()-interval '1 day'));target_message:='TRIAL_OBSERVATION_STALE';
   when 'future' then bad:=jsonb_set(bad,'{observed_at}',to_jsonb(clock_timestamp()+interval '1 day'));target_message:='TRIAL_OBSERVATION_STALE';
   when 'wrong_actor' then bad:=jsonb_set(bad,'{actor_id}','"00000000-0000-0000-0000-000000000001"');target_message:='NOT_AUTHORIZED';
   when 'server_role' then perform set_config('request.jwt.claims','{"role":"authenticated"}',true);target_message:='M9_CONNECTED_SERVER_ONLY';
   when 'extra_init' then bad:=bad||'{"cost_cents":0}'::jsonb;target_message:='TRIAL_INPUT_INVALID';
  end case;
  caught:=false;
  begin perform public.m9_connected_woo_trial('FINISH',bad);
  exception when others then
   if sqlerrm<>target_message then raise exception 'EXPECTED %, GOT %',target_message,sqlerrm; end if;
   caught:=true;
  end;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  if not caught then raise exception 'MISSING_REJECTION %',case_name; end if;n:=n+1;
 end loop;
 done:=public.m9_connected_woo_trial('FINISH',input);
 again:=public.m9_connected_woo_trial('FINISH',input);
 if again->>'replayed'<>'true' or done->>'local_stock_persisted'<>'false' or done->>'native_operations'<>'3'
  or done->'history' is distinct from '[{"phase":"RESERVE","physical":3,"reserved":2,"available":1},{"phase":"CONSUME","physical":1,"reserved":0,"available":1},{"phase":"RESTOCK","physical":3,"reserved":0,"available":3}]'::jsonb
  then raise exception 'CONNECTED_HISTORY_WRONG'; end if;
 select to_jsonb(i) into stock_after from public.inventory_by_location i where variant_id=(s->>'variant_id')::uuid and location_id='467765fe-d18e-43bb-be68-326adbf05ce1';
 if stock_before is distinct from stock_after or exists(select 1 from app.m9_woo_pilot_control where enabled)
  or exists(select 1 from app.m9_woo_pilot_links) or exists(select 1 from app.m9_woo_pilot_orders)
  then raise exception 'CONNECTED_NATIVE_WRITES_REMAIN'; end if;
 foreach role_name in array array['anon','authenticated'] loop
  if has_function_privilege(role_name,'public.m9_connected_woo_trial(text,jsonb)','EXECUTE') then raise exception 'API_EXECUTE_LEAK'; end if;
 end loop;
 insert into connected_result values(jsonb_build_object('mode','SYNTHETIC_CONNECTED_PROTOCOL_NOT_REAL_REMOTE_ORDER','negative_checks',n+1,'native_commands',3,
  'native_replays',3,'final_replayed',true,'dispatch_once',true,'native_inventory_restored',true,'real_remote_order',false));
end $$;
select jsonb_agg(result) as result from connected_result;
rollback;
