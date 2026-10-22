-- FORWARD DDL DRAFT. Maintenance only; root reviews/generates the migration.
-- Never execute this file remotely from the byte verifier or browser.
create table app.m9_variant_photo_refreshes (
 request_id uuid primary key,
 packet_sha256 text not null check(packet_sha256 ~ '^[a-f0-9]{64}$'),
 packet jsonb not null,
 before_state jsonb not null,
 after_state jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 reversed_at timestamptz
);
alter table app.m9_variant_photo_refreshes enable row level security;
revoke all on app.m9_variant_photo_refreshes from public,anon,authenticated,service_role;

create function app.m9_variant_photo_refresh_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and current_user='postgres' and old.reversed_at is null
  and new.reversed_at is not null and new.reversed_at>=old.created_at
  and new.reversed_at<=clock_timestamp()+interval '5 seconds'
  and (to_jsonb(new)-'reversed_at')=(to_jsonb(old)-'reversed_at')
  then return new;end if;
 raise exception 'M9_PHOTO_REFRESH_RECEIPT_IMMUTABLE';
end $$;
revoke all on function app.m9_variant_photo_refresh_immutable() from public,anon,authenticated,service_role;
create trigger m9_variant_photo_refresh_immutable before update or delete on app.m9_variant_photo_refreshes
for each row execute function app.m9_variant_photo_refresh_immutable();

create function app.m9_variant_photo_refresh_state(ids uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_agg(jsonb_build_object('product_id',p.id,'product',to_jsonb(p),
 'catalog',app.web_catalog_snapshot(p.id),'source',to_jsonb(s),'draft',to_jsonb(d),
 'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.variants v where v.product_id=p.id),
 'managed',(select jsonb_agg(to_jsonb(r) order by r.barcode collate "C") from app.m9_rows r join public.variants v on v.id=r.variant_id where v.product_id=p.id),
 'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.variant_id) from app.web_variant_photo_evidence e where e.product_id=p.id),'[]'::jsonb),
 'copies',coalesce((select jsonb_agg(to_jsonb(c) order by c.variant_id) from app.web_variant_photo_storage c join app.web_variant_photo_evidence e on e.variant_id=c.variant_id where e.product_id=p.id),'[]'::jsonb),
 'objects',coalesce((select jsonb_agg(to_jsonb(o) order by o.name,o.id) from storage.objects o where o.bucket_id='product-images'
  and exists(select 1 from app.web_variant_photo_storage c join app.web_variant_photo_evidence e on e.variant_id=c.variant_id
   cross join lateral jsonb_array_elements(c.photos) image where e.product_id=p.id and o.name=substr(image->>'url',length('https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/')+1))),'[]'::jsonb),
 'category_binding',(select to_jsonb(b) from app.web_category_bindings b where b.product_id=p.id)) order by p.id)
 from public.products p left join app.web_content_sources s on s.product_id=p.id
 left join app.web_product_drafts d on d.product_id=p.id where p.id=any(ids);
$$;
revoke all on function app.m9_variant_photo_refresh_state(uuid[]) from public,anon,authenticated,service_role;

create function app.m9_apply_variant_photo_refresh(packet jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare request uuid; sha text; ids uuid[]; f jsonb; i jsonb; old_e jsonb; old_c jsonb;
 p public.products;s app.web_content_sources;d app.web_product_drafts;
 catalog jsonb;v jsonb; saved_variant jsonb; observed jsonb;proof jsonb;
 before_state jsonb;after_state jsonb; refreshed_snapshot jsonb; source_hash text;
 receipt app.m9_variant_photo_refreshes; created integer:=0;preserved integer:=0;
begin
 if current_user<>'postgres' then raise insufficient_privilege;end if;
 perform app.assert_sicar_staging_enabled();
 if packet is null or jsonb_typeof(packet)<>'object'
  or not(packet ?& array['protocol','request_id','export_sha256','read_plan_sha256','file_proofs','families'])
  or (select count(*) from jsonb_object_keys(packet))<>6
  or packet->>'protocol' is distinct from 'm9-variant-photo-refresh-1'
  or coalesce(packet->>'export_sha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(packet->>'read_plan_sha256','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(packet->'families') is distinct from 'array' or jsonb_array_length(packet->'families')<>7
  or jsonb_typeof(packet->'file_proofs') is distinct from 'array' or jsonb_array_length(packet->'file_proofs')<>7
  then raise exception 'M9_PHOTO_REFRESH_INVALID_PACKET';end if;
 request:=(packet->>'request_id')::uuid;
 sha:=encode(extensions.digest(packet::text,'sha256'),'hex');
 if (select array_agg((x->>'woo_product_id')::bigint order by (x->>'woo_product_id')::bigint) from jsonb_array_elements(packet->'families') x)
   is distinct from array[7981,11949,21265,35045,36300,37110,38374]::bigint[]
  or (select count(distinct x->>'product_id') from jsonb_array_elements(packet->'families') x)<>7
  or (select sum(jsonb_array_length(x->'new_items')) from jsonb_array_elements(packet->'families') x)<>24
  or (select sum(jsonb_array_length(x->'evidence_before')) from jsonb_array_elements(packet->'families') x)<>25
  then raise exception 'M9_PHOTO_REFRESH_FIXED_SCOPE_REQUIRED';end if;
 select array_agg((x->>'product_id')::uuid order by x->>'product_id') into ids from jsonb_array_elements(packet->'families') x;
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 -- Barrier first: an existing FOR UPDATE writer finishes before we take locks
 -- on evidence/copies; a later writer waits here and then rereads its context.
 lock table public.products in exclusive mode;
 -- Same remaining global order; no uploads or Storage row writes.
 lock table public.products,public.variants,public.barcodes,public.categories,
  public.attribute_values,public.variant_attributes,public.m9_variant_details,
  app.m9_rows,app.m9_products,app.web_content_sources,app.web_product_drafts,
  app.web_variant_photo_evidence,app.web_variant_photo_storage,app.web_category_bindings,
  app.m9_variant_photo_refreshes in share row exclusive mode;
 select * into receipt from app.m9_variant_photo_refreshes where request_id=request;
 if found then
  if receipt.packet_sha256<>sha or receipt.reversed_at is not null
   or app.m9_variant_photo_refresh_state(ids) is distinct from receipt.after_state
   then raise exception 'M9_PHOTO_REFRESH_REPLAY_CHANGED';end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 for proof in select value from jsonb_array_elements(packet->'file_proofs') loop
  if jsonb_typeof(proof)<>'object' or (select count(*) from jsonb_object_keys(proof))<>4
   or not(proof ?& array['url','sha256','bytes','mime'])
   or coalesce(proof->>'url','') !~ '^https://vaquerosm[.]com/wp-content/uploads/[A-Za-z0-9%._~!$&''()*+,;=:@/-]+$'
   or length(proof->>'url')>2000 or coalesce(proof->>'sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(proof->>'bytes','') !~ '^[0-9]{1,7}$' or (proof->>'bytes')::integer not between 1 and 4194304
   or coalesce(proof->>'mime','') not in ('image/jpeg','image/png','image/webp')
   then raise exception 'M9_PHOTO_REFRESH_INVALID_BYTE_PROOF';end if;
 end loop;
 if (select count(distinct x->>'url') from jsonb_array_elements(packet->'file_proofs') x)<>7
  then raise exception 'M9_PHOTO_REFRESH_DUPLICATE_BYTE_PROOF';end if;
 before_state:=app.m9_variant_photo_refresh_state(ids);
 for f in select value from jsonb_array_elements(packet->'families') order by value->>'product_id' loop
  if jsonb_typeof(f)<>'object' or (select count(*) from jsonb_object_keys(f))<>11
   or not(f ?& array['product_id','woo_product_id','product_before','catalog_hash','source_before','draft_before',
    'evidence_before','copies_before','category_before','woo_variants','new_items'])
   or jsonb_typeof(f->'new_items') is distinct from 'array' or jsonb_array_length(f->'new_items') not between 1 and 200
   or jsonb_typeof(f->'woo_variants') is distinct from 'array'
   or (select count(distinct x->>'id') from jsonb_array_elements(f->'woo_variants') x)<>jsonb_array_length(f->'woo_variants')
   then raise exception 'M9_PHOTO_REFRESH_FAMILY_EXPECTATIONS_REQUIRED';end if;
  select * into strict p from public.products where id=(f->>'product_id')::uuid;
  select * into strict s from app.web_content_sources where product_id=p.id;
  select * into strict d from app.web_product_drafts where product_id=p.id;
  catalog:=app.web_catalog_snapshot(p.id);
  if to_jsonb(p) is distinct from f->'product_before' or p.image_path is not null or not p.is_active
   or md5(catalog::text) is distinct from f->>'catalog_hash' or catalog->>'active' is distinct from 'true'
   or to_jsonb(s) is distinct from f->'source_before' or to_jsonb(d) is distinct from f->'draft_before'
   or s.snapshot->>'source_status' is distinct from 'publish' or s.snapshot->>'type' is distinct from 'variable'
   or s.snapshot->>'woo_product_id' is distinct from f->>'woo_product_id'
   or not exists(select 1 from app.m9_products m where m.product_id=p.id and m.woo_id::text=f->>'woo_product_id')
   or jsonb_typeof(d.content->'images') is distinct from 'array' or jsonb_array_length(d.content->'images')=0
   then raise exception 'M9_PHOTO_REFRESH_LIVE_CONTEXT_CHANGED';end if;
  if coalesce((select jsonb_agg(to_jsonb(e) order by e.variant_id) from app.web_variant_photo_evidence e where e.product_id=p.id),'[]'::jsonb)
    is distinct from f->'evidence_before'
   or coalesce((select jsonb_agg(to_jsonb(c) order by c.variant_id) from app.web_variant_photo_storage c join app.web_variant_photo_evidence e on e.variant_id=c.variant_id where e.product_id=p.id),'[]'::jsonb)
    is distinct from f->'copies_before'
   or (select to_jsonb(b) from app.web_category_bindings b where b.product_id=p.id) is distinct from nullif(f->'category_before','null'::jsonb)
   then raise exception 'M9_PHOTO_REFRESH_EVIDENCE_OR_COPY_CHANGED';end if;
  -- Reconfirm the literal current SICAR row for every variant in this family.
  if exists(select 1 from public.variants vv left join app.m9_rows r on r.variant_id=vv.id
    where vv.product_id=p.id and (r.variant_id is null or r.source_row is distinct from app.m9_rehearsal_current_row(vv.id)))
   then raise exception 'M9_PHOTO_REFRESH_CATALOG_ROW_CHANGED';end if;
  for old_e in select value from jsonb_array_elements(f->'evidence_before') loop
   select value into observed from jsonb_array_elements(f->'woo_variants') where value->>'id'=old_e->>'woo_variation_id';
   select value into v from jsonb_array_elements(catalog->'variants') where value->>'id'=old_e->>'variant_id';
   if old_e->>'catalog_fingerprint' is distinct from md5(catalog::text)
    or not exists(select 1 from app.m9_rows r where r.variant_id=(old_e->>'variant_id')::uuid
      and r.barcode=old_e->>'barcode' and r.source_row->'attributes'=v->'attributes')
    or not (
     (select count(*) from jsonb_array_elements(s.snapshot->'variants') x where x->>'barcode'=old_e->>'barcode'
       and x->>'woo_variation_id'=old_e->>'woo_variation_id' and x->'attributes_sicar'=v->'attributes')=1
     or (old_e->>'supplemental'='true' and not exists(select 1 from jsonb_array_elements(s.snapshot->'variants') x
       where x->>'barcode'=old_e->>'barcode' or x->>'woo_variation_id'=old_e->>'woo_variation_id')))
    then raise exception 'M9_PHOTO_REFRESH_PREVIOUS_CATALOG_CHANGED';end if;
   if observed is distinct from old_e->'source_variant' or observed->>'status' is distinct from 'publish'
    or old_e->>'source_fingerprint' is distinct from md5(to_jsonb(s)::text)
    or old_e->>'product_id' is distinct from p.id::text or old_e->>'woo_product_id' is distinct from f->>'woo_product_id'
    or v is null or v->>'barcode' is distinct from old_e->>'barcode' or v->>'active' is distinct from 'true'
    or v->>'woo_product_id' is distinct from old_e->>'woo_product_id' or v->>'woo_variation_id' is distinct from old_e->>'woo_variation_id'
    then raise exception 'M9_PHOTO_REFRESH_PREVIOUS_EVIDENCE_NOT_REVALIDATED';end if;
   select value into old_c from jsonb_array_elements(f->'copies_before') where value->>'variant_id'=old_e->>'variant_id';
   if old_c is null or old_c->>'evidence_hash' is distinct from md5(old_e::text)
    then raise exception 'M9_PHOTO_REFRESH_PREVIOUS_COPY_NOT_REVALIDATED';end if;
   perform o.id from storage.objects o where o.bucket_id='product-images' and o.name in (
    select p.id::text||'/'||(x->>'sha256')||'.'||case x->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end
    from jsonb_array_elements(old_e->'photos') x) order by o.id for share;
   if coalesce((select string_agg(x->>'url',', ' order by n) from jsonb_array_elements(old_e->'photos') with ordinality a(x,n)),'')
     is distinct from observed->>'images'
    or old_c->'photos' is distinct from (select jsonb_agg(jsonb_build_object('url',
      'https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/'||p.id::text||'/'||
      (x->>'sha256')||'.'||case x->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end,
      'alt',x->>'alt') order by n) from jsonb_array_elements(old_e->'photos') with ordinality a(x,n))
    or exists(select 1 from jsonb_array_elements(old_e->'photos') x where not exists(select 1 from storage.objects o
     where o.bucket_id='product-images' and o.name=p.id::text||'/'||(x->>'sha256')||'.'||
      case x->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end
      and o.metadata->>'size'=x->>'bytes' and o.metadata->>'mimetype'=x->>'mime'))
    then raise exception 'M9_PHOTO_REFRESH_PREVIOUS_OBJECT_CHANGED';end if;
  end loop;
  if (select count(distinct x->>'variant_id') from jsonb_array_elements(f->'new_items') x)<>jsonb_array_length(f->'new_items')
   then raise exception 'M9_PHOTO_REFRESH_DUPLICATE_NEW_VARIANT';end if;
  for i in select value from jsonb_array_elements(f->'new_items') loop
   select value into v from jsonb_array_elements(catalog->'variants') where value->>'id'=i->>'variant_id';
   select value into observed from jsonb_array_elements(f->'woo_variants') where value->>'id'=i->>'woo_variation_id';
   if v is null or v->>'active' is distinct from 'true' or v->>'barcode' is distinct from i->>'barcode'
    or v->>'woo_product_id' is distinct from f->>'woo_product_id' or v->>'woo_product_id' is distinct from i->>'woo_product_id'
    or v->>'woo_variation_id' is distinct from i->>'woo_variation_id' or observed is distinct from i->'source_variant'
    or observed->>'status' is distinct from 'publish' or jsonb_typeof(observed->'images') is distinct from 'string'
    or exists(select 1 from app.web_variant_photo_evidence e where e.variant_id=(i->>'variant_id')::uuid)
    then raise exception 'M9_PHOTO_REFRESH_NEW_IDENTITY_CHANGED';end if;
   if (select count(*) from jsonb_array_elements(s.snapshot->'variants') x where x->>'barcode'=i->>'barcode'
      and x->>'woo_variation_id'=i->>'woo_variation_id')<>1 then raise exception 'M9_PHOTO_REFRESH_SAVED_LINK_CHANGED';end if;
   select value into saved_variant from jsonb_array_elements(s.snapshot->'variants')
    where value->>'barcode'=i->>'barcode' and value->>'woo_variation_id'=i->>'woo_variation_id';
   if saved_variant->>'images_woo' is distinct from '' or saved_variant->'attributes_woo' is distinct from observed->'attributes'
    or saved_variant->'attributes_sicar' is distinct from v->'attributes'
    or jsonb_typeof(i->'photos') is distinct from 'array' or jsonb_array_length(i->'photos')<>1
    then raise exception 'M9_PHOTO_REFRESH_NOT_EXACT_PHOTO_ADDITION';end if;
   select value into proof from jsonb_array_elements(packet->'file_proofs') where value->>'url'=observed->>'images';
   if proof is null or i#>'{photos,0}' is distinct from proof||jsonb_build_object('alt','')
    then raise exception 'M9_PHOTO_REFRESH_BYTES_NOT_VERIFIED';end if;
  end loop;
  select jsonb_set(s.snapshot,'{variants}',jsonb_agg(case when n.value is not null
    then jsonb_set(x.value,'{images_woo}',n.value#>'{source_variant,images}') else x.value end order by x.ord))
   into refreshed_snapshot from jsonb_array_elements(s.snapshot->'variants') with ordinality x(value,ord)
   left join jsonb_array_elements(f->'new_items') n(value) on n.value->>'barcode'=x.value->>'barcode';
  update app.web_content_sources set snapshot=refreshed_snapshot where product_id=p.id;
  select md5(to_jsonb(z)::text) into source_hash from app.web_content_sources z where z.product_id=p.id;
  -- Only after every old row has been checked against current Woo/catalog.
  update app.web_variant_photo_evidence set source_fingerprint=source_hash where product_id=p.id;
  update app.web_variant_photo_storage c set evidence_hash=md5(to_jsonb(e)::text)
   from app.web_variant_photo_evidence e where c.variant_id=e.variant_id and e.product_id=p.id;
  perform app.import_variant_photo_evidence(p.id,f->>'catalog_hash',source_hash,md5(to_jsonb(d)::text),packet->>'export_sha256',f->'new_items');
  created:=created+jsonb_array_length(f->'new_items');preserved:=preserved+jsonb_array_length(f->'evidence_before');
 end loop;
 after_state:=app.m9_variant_photo_refresh_state(ids);
 insert into app.m9_variant_photo_refreshes(request_id,packet_sha256,packet,before_state,after_state,result)
 values(request,sha,packet,before_state,after_state,jsonb_build_object('request_id',request,'created',created,
  'previous_evidence_revalidated',preserved,'families',7,'category_bindings_require_review',true,
  'inventory_modified',false,'woo_modified',false,'replayed',false)) returning * into receipt;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.variant_photos.refresh_source','migration',request::text,
  jsonb_build_object('packet_sha256',sha,'created',created,'preserved',preserved,'families',7,'category_review_required',true,'woo_modified',false,'inventory_modified',false));
 return receipt.result;
end $$;
revoke all on function app.m9_apply_variant_photo_refresh(jsonb) from public,anon,authenticated,service_role;

create function app.m9_reverse_variant_photo_refresh(request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare receipt app.m9_variant_photo_refreshes;ids uuid[];f jsonb;e jsonb;c jsonb;removed integer:=0;
begin
 if current_user<>'postgres' then raise insufficient_privilege;end if;
 perform app.assert_sicar_staging_enabled();
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 lock table public.products in exclusive mode;
 lock table public.products,public.variants,public.barcodes,public.categories,
  public.attribute_values,public.variant_attributes,public.m9_variant_details,
  app.m9_rows,app.m9_products,app.web_content_sources,app.web_product_drafts,
  app.web_variant_photo_evidence,app.web_variant_photo_storage,app.web_category_bindings,
  app.m9_variant_photo_refreshes in share row exclusive mode;
 select * into strict receipt from app.m9_variant_photo_refreshes where request_id=request;
 if receipt.reversed_at is not null then raise exception 'M9_PHOTO_REFRESH_ALREADY_REVERSED';end if;
 select array_agg((x->>'product_id')::uuid) into ids from jsonb_array_elements(receipt.packet->'families') x;
 -- Freeze current metadata of every previously referenced object before the
 -- after-state comparison. Missing/changed objects hold compensation; no repair.
 perform o.id from storage.objects o where o.bucket_id='product-images' and o.id in (
  select (object_row.data->>'id')::uuid from jsonb_array_elements(receipt.after_state) family_row(data)
   cross join lateral jsonb_array_elements(family_row.data->'objects') object_row(data)) order by o.id for share;
 if app.m9_variant_photo_refresh_state(ids) is distinct from receipt.after_state
  then raise exception 'M9_PHOTO_REFRESH_REVERSAL_CONTEXT_CHANGED';end if;
 for f in select value from jsonb_array_elements(receipt.packet->'families') order by value->>'product_id' loop
  if exists(select 1 from app.web_variant_photo_storage z join jsonb_array_elements(f->'new_items') x on z.variant_id=(x->>'variant_id')::uuid)
   then raise exception 'M9_PHOTO_REFRESH_NEW_COPY_ALREADY_EXISTS';end if;
  delete from app.web_variant_photo_evidence z using jsonb_array_elements(f->'new_items') x where z.variant_id=(x->>'variant_id')::uuid;
  removed:=removed+jsonb_array_length(f->'new_items');
  update app.web_content_sources set snapshot=f#>'{source_before,snapshot}' where product_id=(f->>'product_id')::uuid;
  for e in select value from jsonb_array_elements(f->'evidence_before') loop
   update app.web_variant_photo_evidence set source_fingerprint=e->>'source_fingerprint' where variant_id=(e->>'variant_id')::uuid;
  end loop;
  for c in select value from jsonb_array_elements(f->'copies_before') loop
   update app.web_variant_photo_storage set evidence_hash=c->>'evidence_hash' where variant_id=(c->>'variant_id')::uuid;
  end loop;
 end loop;
 update app.m9_variant_photo_refreshes set reversed_at=now() where request_id=request;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.variant_photos.reverse_refresh','migration',request::text,
  jsonb_build_object('removed',removed,'restored_evidence',25,'category_bindings_stay_held',true,'inventory_modified',false,'woo_modified',false));
 return jsonb_build_object('request_id',request,'removed',removed,'restored_evidence',25,'category_bindings_stay_held',true);
end $$;
revoke all on function app.m9_reverse_variant_photo_refresh(uuid) from public,anon,authenticated,service_role;
