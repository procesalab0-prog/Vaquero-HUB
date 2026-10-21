begin;
create table app.m9_woo_connected_trials (
 id uuid primary key, actor_id uuid not null references public.app_users(id),
 parent_id uuid not null references app.web_remote_jobs(id),
 packet jsonb not null, expected jsonb not null,
 state text not null check(state in ('DISPATCHING','VERIFIED')),
 snapshot jsonb, snapshot_sha256 text, result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 check((state='DISPATCHING' and result is null) or (state='VERIFIED' and result is not null and snapshot is not null and snapshot_sha256 is not null))
);
create index m9_woo_connected_actor on app.m9_woo_connected_trials(actor_id,created_at desc);
create table app.m9_woo_connected_events (
 id bigint generated always as identity primary key,
 trial_id uuid not null references app.m9_woo_connected_trials(id),
 phase text not null check(phase in ('DISPATCHING','VERIFIED')),
 occurred_at timestamptz not null default clock_timestamp(),
 unique(trial_id,phase)
);
alter table app.m9_woo_connected_trials enable row level security;
alter table app.m9_woo_connected_events enable row level security;
revoke all on app.m9_woo_connected_trials,app.m9_woo_connected_events from public,anon,authenticated,service_role;
revoke all on sequence app.m9_woo_connected_events_id_seq from public,anon,authenticated,service_role;
create trigger m9_woo_connected_events_immutable before update or delete on app.m9_woo_connected_events
for each row execute function app.m9_woo_pilot_immutable();

create function public.m9_connected_woo_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.current_user_id();
begin
 perform app.assert_sicar_staging_enabled();
 if actor is null or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id
  where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return jsonb_build_object('families',(select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'name',j.packet->'content'->>'name') order by j.id),'[]'::jsonb)
  from app.web_remote_jobs j where j.actor_id=actor and j.state='SUCCEEDED' and j.id in
   ('97c82026-b3cc-4c60-8f22-13d7c00fb33a'::uuid,'ba239bba-7691-43cc-9c76-8768a1af9f21'::uuid)),
  'trials',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]'::jsonb) from
   (select id,state,result,created_at from app.m9_woo_connected_trials where actor_id=actor order by created_at desc limit 10) t));
end $$;
revoke all on function public.m9_connected_woo_status() from public,anon,service_role;
grant execute on function public.m9_connected_woo_status() to authenticated;

-- This server-only RPC validates the active ADMIN owning the prior family receipt.
-- It cannot collect money or persist inventory. The browser has no execute grant.
create function public.m9_connected_woo_trial(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid; tid uuid; parent uuid; j app.web_remote_jobs; job app.m9_woo_connected_trials;
 chosen jsonb; remote_variant jsonb; packet jsonb; expected jsonb; s jsonb; h text;
 v uuid; loc uuid:='467765fe-d18e-43bb-be68-326adbf05ce1';
 old_claims text; old_sub text; trial_result jsonb; effect jsonb; history jsonb:='[]';
 cmd jsonb; phase text; ver integer:=0; q integer; actual numeric; reserved numeric; seed integer;
 receipt_id uuid; observed timestamptz;
begin
 perform app.assert_sicar_staging_enabled();
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
  then raise exception 'M9_CONNECTED_SERVER_ONLY' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>20000 then raise exception 'TRIAL_INPUT_INVALID'; end if;
 actor:=(p_input->>'actor_id')::uuid;tid:=(p_input->>'id')::uuid;
 if actor is null or tid is null or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id
  where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-connected-trial/'||tid,0));
 select * into job from app.m9_woo_connected_trials where id=tid for update;
 if found and job.actor_id<>actor then raise exception 'TRIAL_OWNER_CHANGED' using errcode='42501'; end if;
 if p_action='INIT' then
  if (select array_agg(k order by k) from jsonb_object_keys(p_input) k) is distinct from array['actor_id','id','parent_id']::text[] then raise exception 'TRIAL_INPUT_INVALID'; end if;
  parent:=(p_input->>'parent_id')::uuid;
  if job.id is not null then
   if job.parent_id is distinct from parent then raise exception 'TRIAL_REQUEST_CHANGED'; end if;
   return jsonb_build_object('state',job.state,'dispatch',false,'packet',job.packet,'expected',job.expected,'result',job.result);
  end if;
  if parent not in ('97c82026-b3cc-4c60-8f22-13d7c00fb33a'::uuid,'ba239bba-7691-43cc-9c76-8768a1af9f21'::uuid)
   then raise exception 'TRIAL_FAMILY_ONLY'; end if;
  if (select count(*) from app.m9_woo_connected_trials where actor_id=actor and created_at>clock_timestamp()-interval '24 hours')>=5
   then raise exception 'TRIAL_DAILY_LIMIT'; end if;
  select * into strict j from app.web_remote_jobs where id=parent and actor_id=actor and state='SUCCEEDED';
  select value into strict chosen from jsonb_array_elements(j.packet->'variants') where value->'attributes'->>'TALLA'='M';
  select value into strict remote_variant from jsonb_array_elements(j.receipt->'verified'->'variants') where value->>'variant_id'=chosen->>'variant_id';
  v:=(chosen->>'variant_id')::uuid;
  if chosen->>'barcode' is distinct from remote_variant->>'barcode' or chosen->'price_cents' is distinct from remote_variant->'price_cents'
   or not exists(select 1 from public.variants vv join public.products pr on pr.id=vv.product_id join public.barcodes b on b.variant_id=vv.id
    where vv.id=v and vv.product_id=j.product_id and vv.is_active and pr.is_active and pr.measure_unit_code='PIECE'
    and b.source='SICAR' and b.code=chosen->>'barcode' and vv.price_cents=(chosen->>'price_cents')::bigint)
   then raise exception 'TRIAL_CATALOG_CHANGED'; end if;
  packet:=jsonb_build_object('protocol','m9-remote-order-trial-1','trial_id',tid,'parent_id',parent,'barcode',chosen->>'barcode','quantity',2);
  expected:=jsonb_build_object('parent_id',parent,'owner',j.receipt->'owner','variant_id',v,'barcode',chosen->>'barcode',
   'quantity',2,'woo_product_id',j.receipt->'remote_product_id','woo_variation_id',remote_variant->'remote_variation_id','unit_price_cents',chosen->'price_cents');
  insert into app.m9_woo_connected_trials(id,actor_id,parent_id,packet,expected,state) values(tid,actor,parent,packet,expected,'DISPATCHING');
  insert into app.m9_woo_connected_events(trial_id,phase) values(tid,'DISPATCHING');
  return jsonb_build_object('state','DISPATCHING','dispatch',true,'packet',packet,'expected',expected);
 end if;
 if p_action is distinct from 'FINISH' or job.id is null or
  (select array_agg(k order by k) from jsonb_object_keys(p_input) k) is distinct from array['actor_id','id','observed_at','snapshot']::text[] then raise exception 'TRIAL_INPUT_INVALID'; end if;
 s:=p_input->'snapshot';observed:=(p_input->>'observed_at')::timestamptz;
 if observed is null or observed>clock_timestamp()+interval '5 seconds' or observed<clock_timestamp()-interval '5 minutes'
  then raise exception 'TRIAL_OBSERVATION_STALE'; end if;
 expected:=job.expected;
 if jsonb_typeof(s) is distinct from 'object' or s->>'protocol' is distinct from 'm9-remote-order-trial-1'
  or s->>'origin' is distinct from 'https://salmon-nightingale-251188.hostingersite.com' or s->>'trial_id' is distinct from tid::text
  or s->>'status' is distinct from 'cancelled' or s->'version' is distinct from '3'::jsonb
  or s->'synthetic' is distinct from 'true'::jsonb or s->'payment_executed' is distinct from 'false'::jsonb
  or s->'shipping_executed' is distinct from 'false'::jsonb
  or (s->>'order_id') !~ '^[1-9][0-9]{0,14}$' or (s->>'line_id') !~ '^[1-9][0-9]{0,14}$'
  or jsonb_typeof(s->'order_id') is distinct from 'number' or jsonb_typeof(s->'line_id') is distinct from 'number'
  or not (s @> expected)
  or s->'steps' is distinct from '[{"phase":"CREATE","status":"pending","version":1},{"phase":"PROCESS","status":"processing","version":2},{"phase":"CANCEL","status":"cancelled","version":3}]'::jsonb
  then raise exception 'TRIAL_SNAPSHOT_IDENTITY'; end if;
 h:=encode(extensions.digest(s::text,'sha256'),'hex');
 if job.state='VERIFIED' then
  if job.snapshot_sha256 is distinct from h then raise exception 'TRIAL_VERIFIED_CHANGED'; end if;
  return job.result||jsonb_build_object('replayed',true);
 end if;
 v:=(expected->>'variant_id')::uuid;q:=(expected->>'quantity')::integer;seed:=q+1;
 select * into strict j from app.web_remote_jobs where id=job.parent_id and actor_id=actor and state='SUCCEEDED';
 if not exists(select 1 from jsonb_array_elements(j.receipt->'verified'->'variants') x
   where x->>'variant_id'=v::text and x->>'barcode'=expected->>'barcode'
   and x->'remote_variation_id'=expected->'woo_variation_id' and x->'price_cents'=expected->'unit_price_cents')
  or j.receipt->'remote_product_id' is distinct from expected->'woo_product_id' then raise exception 'TRIAL_PARENT_CHANGED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-connected-native-rehearsal',0));
 old_claims:=nullif(current_setting('request.jwt.claims',true),'');old_sub:=nullif(current_setting('request.jwt.claim.sub',true),'');
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  lock table app.m9_woo_pilot_control,app.m9_woo_pilot_links,app.m9_rehearsal_control,app.m9_rehearsal_allowlist in share row exclusive mode;
  if exists(select 1 from app.m9_woo_pilot_control where enabled) or exists(select 1 from app.m9_woo_pilot_links)
   or exists(select 1 from app.m9_woo_pilot_orders) or exists(select 1 from app.m9_woo_pilot_receipts)
   then raise exception 'TRIAL_PILOT_NOT_EMPTY'; end if;
  if not exists(select 1 from app.m9_rehearsal_control where singleton and enabled) then raise exception 'TRIAL_REVIEW_GUARD_REQUIRED'; end if;
  if not app.can_access_location(loc) or not exists(select 1 from public.variants vv join public.barcodes b on b.variant_id=vv.id
   where vv.id=v and vv.price_cents=(expected->>'unit_price_cents')::bigint and b.code=expected->>'barcode' and b.source='SICAR')
   then raise exception 'TRIAL_CATALOG_CHANGED'; end if;
  if exists(select 1 from public.inventory_by_location where variant_id=v and location_id=loc and (qty<>0 or reserved_qty<>0))
   then raise exception 'TRIAL_BASELINE_NOT_ZERO'; end if;
  update app.m9_woo_pilot_control set enabled=true,actor_id=actor,location_id=loc,expires_at=clock_timestamp()+interval '5 minutes' where singleton;
  insert into app.m9_woo_pilot_links(origin,woo_product_id,woo_variation_id,variant_id,barcode,evidence_sha256)
   values(s->>'origin',(s->>'woo_product_id')::bigint,(s->>'woo_variation_id')::bigint,v,s->>'barcode',h);
  update app.m9_rehearsal_control set review_sha256=h,expires_at=clock_timestamp()+interval '5 minutes' where singleton;
  update app.m9_rehearsal_allowlist set review_sha256=h,expected_row=app.m9_rehearsal_current_row(v) where variant_id=v;
  perform app.apply_movement(v,loc,'INITIAL_IMPORT',seed,'M9_CONNECTED_QA',tid::text,jsonb_build_object('synthetic',true,'source_physical_count',false));
  foreach phase in array array['RESERVE','CONSUME','RESTOCK'] loop
   cmd:=jsonb_build_object('store_origin',s->>'origin','order_id',s->'order_id','operation_id',tid::text||':'||phase,
    'expected_version',ver,'action',phase,'evidence_sha256',h,'reason','Native Woo synthetic order read; all local inventory effects ROLLBACK',
    'lines',jsonb_build_array(jsonb_build_object('line_id',s->'line_id','product_id',s->'woo_product_id','variation_id',s->'woo_variation_id',
      'barcode',s->>'barcode','quantity',q)));
   effect:=app.m9_woo_pilot_command(cmd);receipt_id:=(effect->>'receipt_id')::uuid;
   if (app.m9_woo_pilot_command(cmd))->>'receipt_id' is distinct from receipt_id::text then raise exception 'TRIAL_REPLAY_FAILED'; end if;
   select qty,reserved_qty into strict actual,reserved from public.inventory_by_location where variant_id=v and location_id=loc;
   history:=history||jsonb_build_array(jsonb_build_object('phase',phase,'physical',actual,'reserved',reserved,'available',actual-reserved));
   ver:=ver+1;
  end loop;
  if actual<>seed or reserved<>0 then raise exception 'TRIAL_NET_STOCK_CHANGED'; end if;
  trial_result:=jsonb_build_object('trial_id',tid,'order_id',s->'order_id','barcode',s->>'barcode','quantity',q,'unit_price_cents',expected->'unit_price_cents',
   'mode','CONNECTED_WOO_SYNTHETIC_NATIVE_ROLLBACK','history',history,'native_operations',3,'idempotent_replays',3,
   'remote_status','cancelled','financial_payment_recorded',false,'local_stock_persisted',false,'replayed',false);
  raise exception using errcode='P9001',message='M9_CONNECTED_QA_ROLLBACK';
 exception when sqlstate 'P9001' then
  if trial_result is null then raise exception 'TRIAL_RESULT_MISSING'; end if;
 end;
 if nullif(current_setting('request.jwt.claims',true),'') is distinct from old_claims or nullif(current_setting('request.jwt.claim.sub',true),'') is distinct from old_sub
  then raise exception 'TRIAL_AUTH_CONTEXT_NOT_RESTORED'; end if;
 update app.m9_woo_connected_trials set state='VERIFIED',snapshot=s,snapshot_sha256=h,result=trial_result where id=tid;
 insert into app.m9_woo_connected_events(trial_id,phase) values(tid,'VERIFIED');
 return trial_result;
end $$;
revoke all on function public.m9_connected_woo_trial(text,jsonb) from public,anon,authenticated;
grant execute on function public.m9_connected_woo_trial(text,jsonb) to service_role;
commit;
