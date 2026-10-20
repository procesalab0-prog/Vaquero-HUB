begin;
create or replace function app.m9_legacy_pilot_api(p_action text,p_input jsonb) returns jsonb
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
  rec:=jsonb_build_object('saved',true,'barcode',d.barcode,'revision',d.revision+1,'import_allowed',false,'count_certified',false,'replayed',false,'before',jsonb_build_object('physical_qty',d.physical_qty,'sold_waiting_qty',d.sold_waiting_qty,'separated_qty',d.separated_qty,'note',d.note,'revision',d.revision),'after',jsonb_build_object('physical_qty',p,'sold_waiting_qty',w,'separated_qty',sep,'note',btrim(p_input->>'note'),'revision',d.revision+1));
  insert into app.m9_legacy_pilot_events values(req,'STOCK_DRAFT',a,h,rec,now());
  return rec;
 end if;
 raise exception 'M9_LEGACY_ACTION_INVALID';
end$$;
commit;
