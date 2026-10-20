begin;
create table app.m9_legacy_registry (
 id uuid primary key default extensions.gen_random_uuid(),
 customer_key text not null unique references app.m9_customer_sources(customer_key),
 batch_sha256 text not null references app.m9_customer_batches(plan_sha256),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references public.app_users(id),
 created_at timestamptz not null default now()
);
create index m9_legacy_registry_batch_idx on app.m9_legacy_registry(batch_sha256);
create index m9_legacy_registry_actor_idx on app.m9_legacy_registry(created_by);
create table app.m9_pilot_stock_drafts (
 barcode text primary key check(barcode=btrim(barcode) and length(barcode)>0),
 variant_id uuid not null references public.variants(id),
 location_id uuid not null references public.locations(id),
 catalog_hash text not null,
 baseline jsonb not null,
 observed_qty bigint not null check(observed_qty>=0),
 observed_at timestamptz not null,
 evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 physical_qty integer check(physical_qty between 0 and 999999),
 sold_waiting_qty integer check(sold_waiting_qty between 0 and 999999),
 separated_qty integer check(separated_qty between 0 and 999999),
 note text not null default '' check(length(note)<=500),
 revision integer not null default 1 check(revision>0),
 updated_by uuid references public.app_users(id),
 updated_at timestamptz not null default now(),
 check(physical_qty is null or coalesce(sold_waiting_qty,0)+coalesce(separated_qty,0)<=physical_qty)
);
create index m9_pilot_drafts_variant_idx on app.m9_pilot_stock_drafts(variant_id);
create index m9_pilot_drafts_location_idx on app.m9_pilot_stock_drafts(location_id);
create index m9_pilot_drafts_actor_idx on app.m9_pilot_stock_drafts(updated_by);
create table app.m9_legacy_pilot_events (
 request_id uuid primary key,
 action text not null check(action in ('REGISTER_SEED','STOCK_DRAFT')),
 actor_user_id uuid not null references public.app_users(id),
 request_hash text not null,
 receipt jsonb not null,
 created_at timestamptz not null default now()
);
create index m9_legacy_events_actor_idx on app.m9_legacy_pilot_events(actor_user_id);
create function app.m9_legacy_event_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$begin raise exception 'M9_LEGACY_EVENT_IMMUTABLE';end$$;
create trigger m9_legacy_events_immutable before update or delete on app.m9_legacy_pilot_events for each row execute function app.m9_legacy_event_immutable();
create trigger m9_legacy_registry_immutable before update or delete on app.m9_legacy_registry for each row execute function app.m9_legacy_event_immutable();

create function app.m9_legacy_actor() returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare a uuid:=(select auth.uid());
begin
 perform app.assert_sicar_staging_enabled();
 if a is null or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=a and u.is_active and r.code='ADMIN') or not app.has_perm('customers.manage') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 return a;
end$$;
create function app.m9_pilot_catalog_hash(v_id uuid,p_code text) returns text
language sql stable security invoker set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('variant',to_jsonb(v),'product',to_jsonb(p),'barcode',p_code)::text,'UTF8'),'sha256'),'hex')
 from public.variants v join public.products p on p.id=v.product_id
 where v.id=v_id and (select count(distinct b.variant_id)=1 and bool_and(b.variant_id=v_id) from public.barcodes b where b.code=p_code)
$$;
create function app.m9_pilot_balance_snapshot(v_id uuid,l_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('present',exists(select 1 from public.inventory_by_location where variant_id=v_id and location_id=l_id),
 'balance',(select jsonb_build_object('qty',qty,'reserved_qty',reserved_qty) from public.inventory_by_location where variant_id=v_id and location_id=l_id),
 'movements',(select count(*) from public.inventory_movements where variant_id=v_id and location_id=l_id))
$$;

create function app.m9_register_legacy_pilot(p_request uuid,p_batch text,p_stock jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a uuid:=app.m9_legacy_actor();h text;r jsonb;s app.m9_customer_sources;v uuid;loc uuid;ch text;old app.m9_legacy_pilot_events;rec jsonb;added int:=0;
begin
 if current_user<>'postgres' or p_request is null or jsonb_typeof(p_stock) is distinct from 'array' or jsonb_array_length(p_stock)<>12 then raise exception 'M9_PRIVATE_REGISTRY_MAINTENANCE_ONLY' using errcode='42501';end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('batch',p_batch,'stock',p_stock)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-register',0));
 select * into old from app.m9_legacy_pilot_events where request_id=p_request;
 if found then
  if old.actor_user_id<>a or old.request_hash<>h or old.action<>'REGISTER_SEED' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 if not exists(select 1 from app.m9_customer_batches where plan_sha256=p_batch and source_scope='APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS' and source_at<=clock_timestamp() and source_at>clock_timestamp()-interval '24 hours') then raise exception 'M9_SOURCE_CUT_STALE';end if;
 if (select count(*) from app.m9_customer_sources where batch_sha256=p_batch)<>61 then raise exception 'M9_LEGACY_SCOPE_CHANGED';end if;
 for s in select * from app.m9_customer_sources where batch_sha256=p_batch order by customer_key for update loop
  ch:=encode(extensions.digest(convert_to(s.payload::text,'UTF8'),'sha256'),'hex');
  if exists(select 1 from app.m9_legacy_registry where customer_key=s.customer_key and (source_hash<>ch or batch_sha256<>p_batch)) then raise exception 'M9_LEGACY_SOURCE_CHANGED';end if;
  if not exists(select 1 from app.m9_legacy_registry where customer_key=s.customer_key) then
   insert into app.m9_legacy_registry(customer_key,batch_sha256,source_hash,created_by) values(s.customer_key,p_batch,ch,a);added:=added+1;
  end if;
 end loop;
 if (select count(distinct value->>'barcode') from jsonb_array_elements(p_stock))<>12 or exists(select 1 from jsonb_array_elements(p_stock) x where not (x->>'barcode'=any(array['2396','12769','11871','606204203409','10000','10010','10','13988','10536','10055','13038','11920']))) then raise exception 'M9_PILOT_SCOPE_CHANGED';end if;
 for r in select value from jsonb_array_elements(p_stock) loop
  if r->>'observed_qty' is null or r->>'observed_qty' !~ '^(0|[1-9][0-9]{0,5})$' or r->>'evidence_sha256' is null or r->>'evidence_sha256' !~ '^[a-f0-9]{64}$' or (r->>'observed_at')::timestamptz>clock_timestamp() or (r->>'observed_at')::timestamptz<clock_timestamp()-interval '24 hours' then raise exception 'M9_PILOT_SOURCE_EVIDENCE_REQUIRED';end if;
  v:=(r->>'variant_id')::uuid;loc:=(r->>'location_id')::uuid;
  if not exists(select 1 from public.locations where id=loc and type='STORE' and is_active and app.can_access_location(id)) then raise exception 'M9_PILOT_LOCATION_REQUIRED';end if;
  ch:=app.m9_pilot_catalog_hash(v,r->>'barcode');
  if ch is null then raise exception 'M9_PILOT_VARIANT_CHANGED';end if;
  if exists(select 1 from app.m9_pilot_stock_drafts where barcode=r->>'barcode') then raise exception 'M9_PILOT_ALREADY_SEEDED';end if;
  insert into app.m9_pilot_stock_drafts(barcode,variant_id,location_id,catalog_hash,baseline,observed_qty,observed_at,evidence_sha256) values(r->>'barcode',v,loc,ch,app.m9_pilot_balance_snapshot(v,loc),(r->>'observed_qty')::bigint,(r->>'observed_at')::timestamptz,r->>'evidence_sha256');
 end loop;
 rec:=jsonb_build_object('registered',added,'source_accounts',61,'pilot_codes',12,'native_customers_created',0,'native_openings_created',0,'stock_movements_created',0,'replayed',false);
 insert into app.m9_legacy_pilot_events values(p_request,'REGISTER_SEED',a,h,rec,now());
 return rec;
end$$;

create function app.m9_legacy_pilot_api(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid:=app.m9_legacy_actor();q text;d app.m9_pilot_stock_drafts;req uuid;h text;old app.m9_legacy_pilot_events;rec jsonb;k text;v text;p integer;w integer;sep integer;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>3000 then raise exception 'M9_LEGACY_INPUT_INVALID';end if;
 if p_action='LIST' then
  q:=left(btrim(coalesce(p_input->>'q','')),100);
  return jsonb_build_object('registered',(select count(*) from app.m9_legacy_registry),
   'customers',coalesce((select jsonb_agg(x.row) from (select jsonb_build_object('id',r.id,'key',r.customer_key,'name',s.payload->>'source_display_name','phone',s.payload->>'phone_candidate','source_balance_cents',s.used_cents,'source_unchanged',r.source_hash=encode(extensions.digest(convert_to(s.payload::text,'UTF8'),'sha256'),'hex')) row from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key) where q='' or position(lower(q) in lower(s.payload->>'source_display_name'))>0 or position(q in coalesce(s.payload->>'phone_candidate',''))>0 or position(lower(q) in r.id::text)>0 order by (s.used_cents>0) desc,s.payload->>'source_display_name',r.id limit 100)x),'[]'),
   'stock',coalesce((select jsonb_agg(jsonb_build_object('barcode',d.barcode,'name',p.name,'variant_id',d.variant_id,'location_id',d.location_id,'observed_qty',d.observed_qty,'observed_at',d.observed_at,'physical_qty',d.physical_qty,'sold_waiting_qty',d.sold_waiting_qty,'separated_qty',d.separated_qty,'note',d.note,'revision',d.revision,'catalog_current',d.catalog_hash is not distinct from app.m9_pilot_catalog_hash(d.variant_id,d.barcode),'balance_current',d.baseline=app.m9_pilot_balance_snapshot(d.variant_id,d.location_id)) order by d.barcode) from app.m9_pilot_stock_drafts d join public.variants v on v.id=d.variant_id join public.products p on p.id=v.product_id where app.can_access_location(d.location_id)),'[]'));
 elsif p_action='SAVE_STOCK_DRAFT' then
  if not app.has_perm('inventory.count') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  req:=(p_input->>'request')::uuid;if req is null then raise exception 'M9_REQUEST_REQUIRED';end if;
  h:=encode(extensions.digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('m9-pilot-request:'||req::text,0));
  select * into old from app.m9_legacy_pilot_events where request_id=req;
  if found then
   if old.action<>'STOCK_DRAFT' or old.actor_user_id<>a or old.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return old.receipt||'{"replayed":true}'::jsonb;
  end if;
  select * into strict d from app.m9_pilot_stock_drafts where barcode=p_input->>'barcode' for update;
  if not app.can_access_location(d.location_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  if (p_input->>'revision')::integer is distinct from d.revision then raise exception 'M9_DRAFT_REVISION_CHANGED';end if;
  if d.catalog_hash is distinct from app.m9_pilot_catalog_hash(d.variant_id,d.barcode) or d.baseline<>app.m9_pilot_balance_snapshot(d.variant_id,d.location_id) then raise exception 'M9_PILOT_BASELINE_CHANGED';end if;
  for k in select unnest(array['physical_qty','sold_waiting_qty','separated_qty']) loop
   v:=p_input->>k;
   if not(p_input?k) or (v is not null and v !~ '^(0|[1-9][0-9]{0,5})$') then raise exception 'M9_EXPLICIT_WHOLE_QUANTITY_REQUIRED';end if;
  end loop;
  if p_input->>'note' is null or length(btrim(p_input->>'note')) not between 5 and 500 then raise exception 'M9_DRAFT_NOTE_REQUIRED';end if;
  p:=(p_input->>'physical_qty')::integer;w:=(p_input->>'sold_waiting_qty')::integer;sep:=(p_input->>'separated_qty')::integer;
  if p is not null and coalesce(w,0)+coalesce(sep,0)>p then raise exception 'M9_COMMITMENTS_EXCEED_PHYSICAL';end if;
  update app.m9_pilot_stock_drafts set physical_qty=p,sold_waiting_qty=w,separated_qty=sep,note=btrim(p_input->>'note'),revision=revision+1,updated_by=a,updated_at=now() where barcode=d.barcode;
  rec:=jsonb_build_object('saved',true,'barcode',d.barcode,'revision',d.revision+1,'import_allowed',false,'count_certified',false,'replayed',false);
  insert into app.m9_legacy_pilot_events values(req,'STOCK_DRAFT',a,h,rec,now());
  return rec;
 end if;
 raise exception 'M9_LEGACY_ACTION_INVALID';
end$$;
create function public.m9_legacy_pilot(p_action text,p_input jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select app.m9_legacy_pilot_api(p_action,p_input)$$;
alter table app.m9_legacy_registry enable row level security;
alter table app.m9_pilot_stock_drafts enable row level security;
alter table app.m9_legacy_pilot_events enable row level security;
revoke all on app.m9_legacy_registry,app.m9_pilot_stock_drafts,app.m9_legacy_pilot_events from public,anon,authenticated,service_role;
revoke all on function app.m9_legacy_actor(),app.m9_pilot_catalog_hash(uuid,text),app.m9_pilot_balance_snapshot(uuid,uuid),app.m9_legacy_event_immutable(),app.m9_register_legacy_pilot(uuid,text,jsonb),app.m9_legacy_pilot_api(text,jsonb),public.m9_legacy_pilot(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app.m9_legacy_pilot_api(text,jsonb),public.m9_legacy_pilot(text,jsonb) to authenticated;
commit;
