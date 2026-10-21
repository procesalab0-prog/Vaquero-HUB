begin;
create table app.m9_availability_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false, actor_id uuid references public.app_users(id),
 location_id uuid references public.locations(id), trial_id uuid,
 expires_at timestamptz,
 check(not enabled or (actor_id is not null and location_id is not null and trial_id is not null and expires_at is not null))
);
insert into app.m9_availability_control(singleton) values(true);
create table app.m9_availability_outbox (
 trial_id uuid not null, variant_id uuid not null references public.variants(id),
 location_id uuid not null references public.locations(id),
 parent_id uuid not null references app.web_remote_jobs(id), barcode text not null,
 revision bigint not null check(revision>0), physical_qty numeric not null,
 reserved_qty numeric not null check(reserved_qty>=0), available_qty numeric not null check(available_qty>=0),
 primary key(trial_id,variant_id,location_id), check(physical_qty-reserved_qty=available_qty)
);
create table app.m9_availability_events (
 trial_id uuid not null, variant_id uuid not null, location_id uuid not null,
 revision bigint not null, physical_qty numeric not null, reserved_qty numeric not null, available_qty numeric not null,
 primary key(trial_id,variant_id,location_id,revision),
 foreign key(trial_id,variant_id,location_id) references app.m9_availability_outbox(trial_id,variant_id,location_id)
);
create table app.m9_remote_availability_trials (
 id uuid primary key references app.m9_woo_connected_trials(id), actor_id uuid not null references public.app_users(id),
 packet jsonb not null, state text not null check(state in('DISPATCHING','VERIFIED')),
 receipt jsonb, check((state='DISPATCHING' and receipt is null) or (state='VERIFIED' and receipt is not null))
);
create table app.m9_concurrency_control (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 actor_id uuid references public.app_users(id), trial_id uuid, expires_at timestamptz,
 check(not enabled or(actor_id is not null and trial_id is not null and expires_at is not null))
);
insert into app.m9_concurrency_control(singleton) values(true);
do $$ declare n text; begin
 foreach n in array array['m9_availability_control','m9_availability_outbox','m9_availability_events','m9_remote_availability_trials','m9_concurrency_control'] loop
  execute format('alter table app.%I enable row level security',n);
  execute format('revoke all on app.%I from public,anon,authenticated,service_role',n);
 end loop;
end $$;
create trigger m9_availability_events_immutable before update or delete on app.m9_availability_events
 for each row execute function app.m9_woo_pilot_immutable();

create function app.m9_capture_availability() returns trigger
language plpgsql security definer set search_path='' as $$
declare c app.m9_availability_control; parent uuid; literal_code text; rev bigint;
begin
 if tg_op='UPDATE' and new.qty=old.qty and new.reserved_qty=old.reserved_qty then return new; end if;
 select * into c from app.m9_availability_control where singleton and enabled for share;
 if not found or new.location_id is distinct from c.location_id then return new; end if;
 perform app.assert_sicar_staging_enabled();
 -- The row trigger is on the canonical book: native POS, returns and reservations all pass here.
 select j.id,x->>'barcode' into parent,literal_code from app.web_remote_jobs j cross join lateral jsonb_array_elements(j.packet->'variants') x
 where j.id in('97c82026-b3cc-4c60-8f22-13d7c00fb33a','ba239bba-7691-43cc-9c76-8768a1af9f21')
 and j.actor_id=c.actor_id and j.state='SUCCEEDED' and x->>'variant_id'=new.variant_id::text;
 if parent is null then return new; end if;
 if c.actor_id is distinct from app.current_user_id() or c.trial_id is null
  or c.expires_at<=clock_timestamp() or c.expires_at>clock_timestamp()+interval '10 minutes'
  or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=c.actor_id and u.is_active and r.code='ADMIN')
  or not app.can_access_location(c.location_id) or app.m9_rehearsal_status(new.variant_id) is not null
  then raise exception 'M9_AVAILABILITY_WINDOW_INVALID'; end if;
 if not exists(select 1 from public.variants v join public.products p on p.id=v.product_id join public.barcodes b on b.variant_id=v.id
  where v.id=new.variant_id and v.is_active and p.is_active and p.measure_unit_code='PIECE' and b.source='SICAR' and b.code=literal_code)
  or new.qty<>trunc(new.qty) or new.reserved_qty<>trunc(new.reserved_qty) or new.qty<new.reserved_qty
  then raise exception 'M9_AVAILABILITY_IDENTITY_INVALID'; end if;
 insert into app.m9_availability_outbox(trial_id,variant_id,location_id,parent_id,barcode,revision,physical_qty,reserved_qty,available_qty)
 values(c.trial_id,new.variant_id,new.location_id,parent,literal_code,1,new.qty,new.reserved_qty,new.qty-new.reserved_qty)
 on conflict(trial_id,variant_id,location_id) do update set revision=app.m9_availability_outbox.revision+1,
 physical_qty=excluded.physical_qty,reserved_qty=excluded.reserved_qty,available_qty=excluded.available_qty returning revision into rev;
 insert into app.m9_availability_events values(c.trial_id,new.variant_id,new.location_id,rev,new.qty,new.reserved_qty,new.qty-new.reserved_qty);
 return new;
end $$;
revoke all on function app.m9_capture_availability() from public,anon,authenticated,service_role;
create trigger m9_capture_availability after insert or update on public.inventory_by_location
 for each row execute function app.m9_capture_availability();

-- Extend the previously accepted native rehearsal only inside its rollback scope.
do $$ declare s text; anchor text; addition text; begin
 s:=pg_get_functiondef('public.m9_connected_woo_trial(text,jsonb)'::regprocedure);
 anchor:='  perform app.apply_movement(v,loc,''INITIAL_IMPORT'',seed,''M9_CONNECTED_QA'',tid::text,jsonb_build_object(''synthetic'',true,''source_physical_count'',false));';
 if position(anchor in s)=0 then raise exception 'AVAILABILITY_SETUP_ANCHOR'; end if;
 addition:='  if exists(select 1 from app.m9_availability_control where enabled) or exists(select 1 from app.m9_availability_outbox) then raise exception ''AVAILABILITY_NOT_EMPTY_DISABLED''; end if;
  update app.m9_availability_control set enabled=true,actor_id=actor,location_id=loc,trial_id=tid,expires_at=clock_timestamp()+interval ''5 minutes'' where singleton;
';
 s:=replace(s,anchor,addition||anchor);
 anchor:='   effect:=app.m9_woo_pilot_command(cmd);receipt_id:=(effect->>''receipt_id'')::uuid;';
 if position(anchor in s)=0 then raise exception 'AVAILABILITY_POS_ANCHOR'; end if;
 addition:='   if phase=''CONSUME'' then
    perform app.apply_movement(v,loc,''SALE'',-1,''M9_AVAILABILITY_POS_QA'',tid::text,jsonb_build_object(''synthetic'',true,''financial_payment_recorded'',false));
    if not exists(select 1 from app.m9_availability_outbox where trial_id=tid and variant_id=v and available_qty=0) then raise exception ''AVAILABILITY_POS_SALE_MISSING''; end if;
    perform app.apply_movement(v,loc,''RETURN'',1,''M9_AVAILABILITY_POS_QA'',tid::text,jsonb_build_object(''synthetic'',true,''financial_payment_recorded'',false));
   end if;
';
 s:=replace(s,anchor,addition||anchor);
 anchor:='   ver:=ver+1;';
 if position(anchor in s)=0 then raise exception 'AVAILABILITY_CHECKPOINT_ANCHOR'; end if;
 s:=replace(s,anchor,'   if not exists(select 1 from app.m9_availability_outbox where trial_id=tid and variant_id=v and location_id=loc and physical_qty=actual and reserved_qty=reserved and available_qty=actual-reserved) then raise exception ''AVAILABILITY_CHECKPOINT_FAILED''; end if;'||chr(10)||anchor);
 anchor:='  raise exception using errcode=''P9001'',message=''M9_CONNECTED_QA_ROLLBACK'';';
 if position(anchor in s)=0 then raise exception 'AVAILABILITY_RESULT_ANCHOR'; end if;
 addition:='  trial_result:=trial_result||jsonb_build_object(''availability_trace'',(select jsonb_agg(jsonb_build_object(''revision'',revision,''physical'',physical_qty,''reserved'',reserved_qty,''available'',available_qty) order by revision) from app.m9_availability_events where trial_id=tid and variant_id=v),''availability_capture_rollback'',true,''pos_inventory_operations'',2);
';
 execute replace(s,anchor,addition||anchor);
end $$;

create function public.m9_connected_availability(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; tid uuid; t app.m9_woo_connected_trials; j app.m9_remote_availability_trials; q integer; packet jsonb; r jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'M9_CONNECTED_SERVER_ONLY' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>20000 then raise exception 'AVAILABILITY_INPUT_INVALID'; end if;
 actor:=(p_input->>'actor_id')::uuid;tid:=(p_input->>'id')::uuid;
 if actor is null or tid is null or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-availability/'||tid,0));
 select * into strict t from app.m9_woo_connected_trials where id=tid and actor_id=actor and state='VERIFIED';
 q:=(t.result->>'quantity')::integer;
 if t.result->'availability_capture_rollback' is distinct from 'true'::jsonb
  or coalesce((select jsonb_agg(x->'available' order by (x->>'revision')::integer) from jsonb_array_elements(t.result->'availability_trace') x)
     not in (jsonb_build_array(0,q+1,1,0,1,q+1,1,q+1),jsonb_build_array(q+1,1,0,1,q+1,1,q+1)),true)
  then raise exception 'AVAILABILITY_CAPTURE_REQUIRED'; end if;
 packet:=jsonb_build_object('protocol','m9-remote-availability-trial-1','trial_id',tid,'quantities',jsonb_build_array(q+1,1,0,1,1,q+1));
 select * into j from app.m9_remote_availability_trials where id=tid for update;
 if p_action='INIT' then
  if (select array_agg(k order by k) from jsonb_object_keys(p_input) k) is distinct from array['actor_id','id']::text[] then raise exception 'AVAILABILITY_INPUT_INVALID'; end if;
  if j.id is not null then return jsonb_build_object('dispatch',false,'state',j.state,'packet',j.packet,'receipt',j.receipt,'expected',t.expected); end if;
  insert into app.m9_remote_availability_trials(id,actor_id,packet,state) values(tid,actor,packet,'DISPATCHING');
  return jsonb_build_object('dispatch',true,'state','DISPATCHING','packet',packet,'expected',t.expected);
 end if;
 if p_action is distinct from 'FINISH' or j.id is null or
  (select array_agg(k order by k) from jsonb_object_keys(p_input) k) is distinct from array['actor_id','id','receipt']::text[] then raise exception 'AVAILABILITY_INPUT_INVALID'; end if;
 r:=p_input->'receipt';
 if r->>'protocol' is distinct from 'm9-remote-availability-trial-1' or r->>'trial_id' is distinct from tid::text
  or r->>'origin' is distinct from 'https://salmon-nightingale-251188.hostingersite.com'
  or r->'synthetic' is distinct from 'true'::jsonb or r->'restored' is distinct from 'true'::jsonb
  or r->'quantities' is distinct from packet->'quantities' or r->>'barcode' is distinct from t.expected->>'barcode'
  or r->'woo_variation_id' is distinct from t.expected->'woo_variation_id'
  or r->'woo_product_id' is distinct from t.expected->'woo_product_id'
  or r->'before' is distinct from r->'after' or jsonb_typeof(r->'before') is distinct from 'object'
  then raise exception 'AVAILABILITY_RECEIPT_CHANGED'; end if;
 if j.state='VERIFIED' and j.receipt is distinct from r then raise exception 'AVAILABILITY_VERIFIED_CHANGED'; end if;
 update app.m9_remote_availability_trials set state='VERIFIED',receipt=r where id=tid;
 return jsonb_build_object('verified',true,'receipt',r);
end $$;
revoke all on function public.m9_connected_availability(text,jsonb) from public,anon,authenticated;
grant execute on function public.m9_connected_availability(text,jsonb) to service_role;
do $$ declare s text; anchor text:='select id,state,result,created_at from app.m9_woo_connected_trials'; begin
 s:=pg_get_functiondef('public.m9_connected_woo_status()'::regprocedure);
 if position(anchor in s)=0 then raise exception 'AVAILABILITY_STATUS_ANCHOR'; end if;
 execute replace(s,anchor,'select id,state,result,created_at,(select jsonb_build_object(''state'',a.state,''receipt'',a.receipt) from app.m9_remote_availability_trials a where a.id=app.m9_woo_connected_trials.id) availability from app.m9_woo_connected_trials');
end $$;
-- Short-lived service-only contention probe. All native effects roll back inside each call.
create function public.m9_inventory_contention_probe(p_action text,p_actor uuid,p_trial uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c app.m9_concurrency_control; v uuid; j app.web_remote_jobs; x jsonb; rv jsonb; effect jsonb;
 loc uuid:='467765fe-d18e-43bb-be68-326adbf05ce1';answer jsonb; started timestamptz; caught boolean:=false;
begin
 perform app.assert_sicar_staging_enabled();
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'M9_CONNECTED_SERVER_ONLY' using errcode='42501';end if;
 select * into strict c from app.m9_concurrency_control where singleton for share;
 if not c.enabled or c.actor_id is distinct from p_actor or c.trial_id is distinct from p_trial or c.expires_at<=clock_timestamp()
  or c.expires_at>clock_timestamp()+interval '2 minutes' or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=p_actor and u.is_active and r.code='ADMIN')
  then raise exception 'M9_CONTENTION_WINDOW_REQUIRED';end if;
 select * into strict j from app.web_remote_jobs where id='97c82026-b3cc-4c60-8f22-13d7c00fb33a' and actor_id=p_actor and state='SUCCEEDED';
 select value into strict x from jsonb_array_elements(j.packet->'variants') where value->'attributes'->>'TALLA'='M';
 select value into strict rv from jsonb_array_elements(j.receipt->'verified'->'variants') where value->>'variant_id'=x->>'variant_id';
 v:=(x->>'variant_id')::uuid;
 if exists(select 1 from public.inventory_by_location where variant_id=v and location_id=loc and(qty<>0 or reserved_qty<>0)) then raise exception 'CONTENTION_BASELINE_NOT_ZERO';end if;
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  if p_action='HOLDER' then
   if exists(select 1 from app.m9_woo_pilot_control where enabled) or exists(select 1 from app.m9_woo_pilot_links) or exists(select 1 from app.m9_woo_pilot_orders) then raise exception 'CONTENTION_PILOT_NOT_EMPTY';end if;
   perform pg_advisory_xact_lock(hashtextextended('m9-contention/'||p_trial,0));
   update app.m9_woo_pilot_control set enabled=true,actor_id=p_actor,location_id=loc,expires_at=clock_timestamp()+interval '1 minute' where singleton;
   update app.m9_rehearsal_control set review_sha256=repeat('d',64),expires_at=clock_timestamp()+interval '1 minute' where singleton;
   update app.m9_rehearsal_allowlist set review_sha256=repeat('d',64),expected_row=app.m9_rehearsal_current_row(v) where variant_id=v;
   insert into app.m9_woo_pilot_links values('https://salmon-nightingale-251188.hostingersite.com',(j.receipt->>'remote_product_id')::bigint,(rv->>'remote_variation_id')::bigint,v,x->>'barcode',repeat('d',64));
   perform app.apply_movement(v,loc,'INITIAL_IMPORT',1,'M9_CONTENTION_QA',p_trial::text,jsonb_build_object('synthetic',true));
   effect:=app.m9_woo_pilot_command(jsonb_build_object('store_origin','https://salmon-nightingale-251188.hostingersite.com','order_id',900001101,'operation_id',p_trial::text,'expected_version',0,'action','RESERVE','evidence_sha256',repeat('d',64),'reason','SYNTHETIC concurrent rollback probe','lines',jsonb_build_array(jsonb_build_object('line_id',1,'product_id',j.receipt->'remote_product_id','variation_id',rv->'remote_variation_id','barcode',x->>'barcode','quantity',1))));
   if not exists(select 1 from public.inventory_by_location where variant_id=v and location_id=loc and qty=1 and reserved_qty=1) then raise exception 'CONTENTION_RESERVATION_FAILED';end if;
   perform pg_sleep(6);
   answer:=jsonb_build_object('phase','HOLDER','pid',pg_backend_pid(),'synthetic_reserved',1,'native_rollback',true);
  elsif p_action='CONTENDER' then
   if pg_try_advisory_xact_lock(hashtextextended('m9-contention/'||p_trial,0)) then raise exception 'CONTENTION_NOT_OBSERVED';end if;
   perform set_config('lock_timeout','1200ms',true);started:=clock_timestamp();
   begin perform app.apply_movement(v,loc,'SALE',-1,'M9_CONTENTION_POS_QA',p_trial::text,jsonb_build_object('synthetic',true));
   exception when lock_not_available then caught:=true;end;
   if not caught then raise exception 'CONTENTION_NATIVE_LOCK_MISSING';end if;
   answer:=jsonb_build_object('phase','CONTENDER','pid',pg_backend_pid(),'native_lock_observed',true,'wait_ms',extract(epoch from clock_timestamp()-started)*1000,'native_rollback',true);
  else raise exception 'CONTENTION_ACTION_INVALID';end if;
  raise exception using errcode='P9002',message='M9_CONTENTION_ROLLBACK';
 exception when sqlstate 'P9002' then if answer is null then raise exception 'CONTENTION_RESULT_MISSING';end if;end;
 return answer;
end $$;
revoke all on function public.m9_inventory_contention_probe(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.m9_inventory_contention_probe(text,uuid,uuid) to service_role;
commit;
