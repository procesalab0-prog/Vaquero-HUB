-- Forward proposal for the existing staging pilot sheet. Root applies after QA.
-- No inventory, reservation, customer, cash, debt, Woo or opening operation.
select app.assert_sicar_staging_enabled();
alter table app.m9_pilot_stock_drafts add column field_evidence jsonb not null default '{}'::jsonb;
alter table app.m9_pilot_stock_drafts add constraint m9_pilot_field_evidence_object check(jsonb_typeof(field_evidence)='object');

create function app.m9_pilot_field_source_hash(d app.m9_pilot_stock_drafts)returns text
language sql stable security invoker set search_path='' set timezone='UTC' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object(
  'barcode',d.barcode,'variant_id',d.variant_id,'location_id',d.location_id,
  'observed_qty',d.observed_qty,'observed_at',to_char(d.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source_evidence_sha256',d.evidence_sha256,
  'expected_catalog',d.catalog_hash,'current_catalog',app.m9_pilot_catalog_hash(d.variant_id,d.barcode),
  'expected_balance',d.baseline,'current_balance',app.m9_pilot_balance_snapshot(d.variant_id,d.location_id))::text,'UTF8'),'sha256'),'hex')
$$;
create function app.m9_pilot_field_views(d app.m9_pilot_stock_drafts)returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare k text;m jsonb;q jsonb;state text;result jsonb:='{}';src text:=app.m9_pilot_field_source_hash(d);actor_name text;
begin
 for k in select unnest(array['physical_qty','sold_waiting_qty','separated_qty'])loop
  q:=to_jsonb(d)->k;m:=d.field_evidence->k;actor_name:=null;
  if q='null'::jsonb then state:='UNKNOWN';
  elsif m is null then state:='UNATTRIBUTED_DRAFT';
  elsif m->>'kind'='HUMAN_DECLARATION_NOW'and m->'quantity'=q and m->>'source_snapshot_sha256'=src
   and d.catalog_hash=app.m9_pilot_catalog_hash(d.variant_id,d.barcode)and d.baseline=app.m9_pilot_balance_snapshot(d.variant_id,d.location_id)
   then state:='DECLARED_CURRENT';
  else state:='HELD_SOURCE_OR_BASELINE_CHANGED';end if;
  if m is not null then select u.full_name into actor_name from public.app_users u where u.id::text=m->>'actor_user_id';end if;
  result:=result||jsonb_build_object(k,jsonb_build_object('status',state,'declaration',m,'actor_name',actor_name));
 end loop;
 return result;
end $$;
revoke all on function app.m9_pilot_field_source_hash(app.m9_pilot_stock_drafts),app.m9_pilot_field_views(app.m9_pilot_stock_drafts)from public,anon,authenticated,service_role;

create or replace function app.m9_legacy_pilot_api(p_action text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare a uuid:=app.m9_legacy_actor();q text;d app.m9_pilot_stock_drafts;after_d app.m9_pilot_stock_drafts;
 req uuid;h text;old app.m9_legacy_pilot_events;rec jsonb;k text;v text;p integer;w integer;sep integer;
 incoming jsonb;metadata jsonb;declaration jsonb;new_value jsonb;old_value jsonb;src text;at_at timestamptz;changes int:=0;retired int:=0;
begin
 -- Same active ADMIN/customers.manage/staging actor guard, before every path.
 if jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>6000 then raise exception 'M9_LEGACY_INPUT_INVALID';end if;
 if p_action='LIST'then
  q:=left(btrim(coalesce(p_input->>'q','')),100);
  return jsonb_build_object('registered',(select count(*)from app.m9_legacy_registry),
   'customers',coalesce((select jsonb_agg(x.row)from(select jsonb_build_object('id',r.id,'key',r.customer_key,'name',s.payload->>'source_display_name','phone',s.payload->>'phone_candidate','source_balance_cents',s.used_cents,'source_unchanged',r.source_hash=encode(extensions.digest(convert_to(s.payload::text,'UTF8'),'sha256'),'hex'))row from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key)where q=''or position(lower(q)in lower(s.payload->>'source_display_name'))>0 or position(q in coalesce(s.payload->>'phone_candidate',''))>0 or position(lower(q)in r.id::text)>0 order by(s.used_cents>0)desc,s.payload->>'source_display_name',r.id limit 100)x),'[]'),
   'stock',coalesce((select jsonb_agg(jsonb_build_object('barcode',s.barcode,'name',p.name,'variant_id',s.variant_id,'location_id',s.location_id,'observed_qty',s.observed_qty,'observed_at',s.observed_at,'physical_qty',s.physical_qty,'sold_waiting_qty',s.sold_waiting_qty,'separated_qty',s.separated_qty,'note',s.note,'revision',s.revision,'catalog_current',s.catalog_hash is not distinct from app.m9_pilot_catalog_hash(s.variant_id,s.barcode),'balance_current',s.baseline=app.m9_pilot_balance_snapshot(s.variant_id,s.location_id),
    'field_source_sha256',app.m9_pilot_field_source_hash(s),'field_evidence',app.m9_pilot_field_views(s))order by s.barcode)from app.m9_pilot_stock_drafts s join public.variants v on v.id=s.variant_id join public.products p on p.id=v.product_id where app.can_access_location(s.location_id)),'[]'));
 elsif p_action='SAVE_STOCK_DRAFT'then
  if not app.has_perm('inventory.count')then raise exception 'NOT_AUTHORIZED'using errcode='42501';end if;
  if exists(select 1 from jsonb_object_keys(p_input)x where x not in('request','barcode','revision','physical_qty','sold_waiting_qty','separated_qty','note','expected_source_sha256','count_evidence'))
   or not(p_input?&array['request','barcode','revision','physical_qty','sold_waiting_qty','separated_qty','note'])
   or jsonb_typeof(p_input->'request')is distinct from'string'or coalesce(p_input->>'request','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or jsonb_typeof(p_input->'barcode')is distinct from'string'or not(p_input->>'barcode'=any(array['2396','12769','11871','606204203409','10000','10010','10','13988','10536','10055','13038','11920']))
   or coalesce(p_input->>'revision','')!~'^[1-9][0-9]{0,8}$'
   then raise exception 'M9_LEGACY_INPUT_INVALID';end if;
  req:=(p_input->>'request')::uuid;h:=encode(extensions.digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  if not pg_try_advisory_xact_lock(hashtextextended('m9-pilot-request:'||req::text,0))then
   raise exception 'M9_PILOT_BUSY_RETRY'using errcode='55P03';end if;
  -- Never wait while holding catalog barriers: the native inventory trigger
  -- acquires inventory first, then variants. NOWAIT breaks that inversion.
  -- The outer exception subtransaction releases every acquired barrier on failure.
  lock table public.products in exclusive mode nowait;lock table public.variants in exclusive mode nowait;
  lock table public.barcodes,app.m9_pilot_stock_drafts,public.inventory_by_location,public.inventory_movements in share row exclusive mode nowait;
  select*into strict d from app.m9_pilot_stock_drafts where barcode=p_input->>'barcode'for update nowait;
  if not app.can_access_location(d.location_id)then raise exception 'NOT_AUTHORIZED'using errcode='42501';end if;
  select*into old from app.m9_legacy_pilot_events where request_id=req;
  if found then
   if old.action<>'STOCK_DRAFT'or old.actor_user_id<>a or old.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return old.receipt||'{"replayed":true,"historical_receipt":true}'::jsonb;
  end if;
  if(p_input->>'revision')::integer is distinct from d.revision then raise exception 'M9_DRAFT_REVISION_CHANGED';end if;
  if d.catalog_hash is distinct from app.m9_pilot_catalog_hash(d.variant_id,d.barcode)or d.baseline<>app.m9_pilot_balance_snapshot(d.variant_id,d.location_id)then raise exception 'M9_PILOT_BASELINE_CHANGED';end if;
  src:=app.m9_pilot_field_source_hash(d);
  if p_input?'expected_source_sha256'and(jsonb_typeof(p_input->'expected_source_sha256')is distinct from'string'or p_input->>'expected_source_sha256'is distinct from src)then raise exception 'M9_FIELD_SOURCE_CHANGED';end if;
  for k in select unnest(array['physical_qty','sold_waiting_qty','separated_qty'])loop
   v:=p_input->>k;
   if not(p_input?k)or(jsonb_typeof(p_input->k)is distinct from'null'and(jsonb_typeof(p_input->k)is distinct from'number'or v!~'^(0|[1-9][0-9]{0,5})$'))then raise exception 'M9_EXPLICIT_WHOLE_QUANTITY_REQUIRED';end if;
  end loop;
  if jsonb_typeof(p_input->'note')is distinct from'string'or length(btrim(p_input->>'note'))not between 5 and 500 then raise exception 'M9_DRAFT_NOTE_REQUIRED';end if;
  p:=(p_input->>'physical_qty')::integer;w:=(p_input->>'sold_waiting_qty')::integer;sep:=(p_input->>'separated_qty')::integer;
  if p is not null and coalesce(w,0)+coalesce(sep,0)>p then raise exception 'M9_COMMITMENTS_EXCEED_PHYSICAL';end if;
  incoming:=coalesce(p_input->'count_evidence','{}'::jsonb);
  if jsonb_typeof(incoming)is distinct from'object'or exists(select 1 from jsonb_object_keys(incoming)x where x not in('physical_qty','sold_waiting_qty','separated_qty'))then raise exception 'M9_FIELD_DECLARATION_REQUIRED';end if;
  if(p is not null or w is not null or sep is not null)and(not(p_input?'count_evidence')or not(p_input?'expected_source_sha256'))then raise exception 'M9_FIELD_DECLARATION_REQUIRED';end if;
  metadata:=d.field_evidence;at_at:=clock_timestamp();
  for k in select unnest(array['physical_qty','sold_waiting_qty','separated_qty'])loop
   new_value:=p_input->k;old_value:=to_jsonb(d)->k;declaration:=incoming->k;
   if new_value='null'::jsonb then
    if declaration is not null then raise exception 'M9_FIELD_QUANTITY_REQUIRED';end if;
    if old_value is distinct from new_value then retired:=retired+1;end if;
    metadata:=metadata-k;
   elsif declaration is not null then
    if not app.m9_detail_shape(declaration,array['declared_now','source'])or declaration->'declared_now'is distinct from'true'::jsonb
     or jsonb_typeof(declaration->'source')is distinct from'string'or length(declaration->>'source')not between 5 and 200
     or declaration->>'source'<>btrim(declaration->>'source')or declaration->>'source'~'[[:cntrl:]]'then raise exception 'M9_FIELD_DECLARATION_REQUIRED';end if;
    metadata:=metadata||jsonb_build_object(k,jsonb_build_object('kind','HUMAN_DECLARATION_NOW','quantity',new_value,'source',declaration->>'source','actor_user_id',a,'declared_at',at_at,'captured_revision',d.revision+1,'source_snapshot_sha256',src,'count_certified',false));changes:=changes+1;
   elsif new_value is distinct from old_value or not(metadata?k)then raise exception 'M9_FIELD_DECLARATION_REQUIRED';end if;
  end loop;
  update app.m9_pilot_stock_drafts set physical_qty=p,sold_waiting_qty=w,separated_qty=sep,note=btrim(p_input->>'note'),field_evidence=metadata,revision=revision+1,updated_by=a,updated_at=at_at where barcode=d.barcode returning*into after_d;
  rec:=jsonb_build_object('saved',true,'barcode',d.barcode,'revision',after_d.revision,'import_allowed',false,'count_certified',false,'replayed',false,'declarations_recorded',changes,'declarations_retired',retired,
   'before',jsonb_build_object('physical_qty',d.physical_qty,'sold_waiting_qty',d.sold_waiting_qty,'separated_qty',d.separated_qty,'note',d.note,'revision',d.revision,'field_evidence',d.field_evidence),
   'after',jsonb_build_object('physical_qty',p,'sold_waiting_qty',w,'separated_qty',sep,'note',after_d.note,'revision',after_d.revision,'field_evidence',metadata),'source_snapshot_sha256',src,'actor_user_id',a,'declared_at',at_at);
  insert into app.m9_legacy_pilot_events values(req,'STOCK_DRAFT',a,h,rec,at_at);
  return rec;
 end if;
 raise exception 'M9_LEGACY_ACTION_INVALID';
exception when lock_not_available then
 raise exception 'M9_PILOT_BUSY_RETRY'using errcode='55P03';
end $$;
revoke all on function app.m9_legacy_pilot_api(text,jsonb)from public,anon,service_role;
grant execute on function app.m9_legacy_pilot_api(text,jsonb)to authenticated;
-- Existing public.m9_legacy_pilot remains SECURITY INVOKER, unchanged grants.
