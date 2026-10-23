begin;
select app.assert_sicar_staging_enabled();
-- Forward draft only. No remote execution by the preparing agent.
create table app.m9_photo_category_reviews(
 request_id uuid primary key,
 refresh_id uuid not null unique references app.m9_variant_photo_refreshes(request_id),
 packet_sha256 text not null,
 packet jsonb not null,
 before_state jsonb not null,
 after_state jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 reversed_at timestamptz
);
alter table app.m9_photo_category_reviews enable row level security;
revoke all on app.m9_photo_category_reviews from public,anon,authenticated,service_role;
create trigger m9_photo_category_review_immutable before update or delete on app.m9_photo_category_reviews
for each row execute function app.m9_variant_photo_refresh_immutable();

create function app.m9_review_categories_after_photo_refresh(p_packet jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare rid uuid;ids uuid[];packet_hash text;refresh app.m9_variant_photo_refreshes;
 review app.m9_photo_category_reviews;f jsonb;old_f jsonb;after_f jsonb;fp jsonb;b app.web_category_bindings;
 capture jsonb;captured_at timestamptz;category_count integer;canonical_paths jsonb;mapping jsonb;product jsonb;
 source app.web_content_sources;draft app.web_product_drafts;e app.web_variant_photo_evidence;photo_copy app.web_variant_photo_storage;
 wanted jsonb;before_state jsonb;after_state jsonb;reverified integer:=0;
begin
 if current_user<>'postgres' then raise insufficient_privilege;end if;
 perform app.assert_sicar_staging_enabled();
 if p_packet is null or jsonb_typeof(p_packet)<>'object' or (select count(*) from jsonb_object_keys(p_packet))<>8
  or not(p_packet ?& array['protocol','request_id','refresh_id','expected_receipt_sha256','capture_sha256','capture','expected_current','mappings'])
  or p_packet->>'protocol' is distinct from 'm9-photo-category-review-1'
  or p_packet->>'refresh_id' is distinct from 'd54ce08a-dcd9-4dba-824a-95164888ead7'
  or coalesce(p_packet->>'expected_receipt_sha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_packet->>'capture_sha256','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_packet->'expected_current') is distinct from 'array' or jsonb_array_length(p_packet->'expected_current')<>7
  or jsonb_typeof(p_packet->'mappings') is distinct from 'array' or jsonb_array_length(p_packet->'mappings')<>7
  then raise exception 'PHOTO_CATEGORY_EXACT_PACKET_REQUIRED';end if;
 rid:=(p_packet->>'request_id')::uuid;packet_hash:=encode(extensions.digest(p_packet::text,'sha256'),'hex');
 capture:=p_packet->'capture';captured_at:=(capture->>'captured_at')::timestamptz;
 if captured_at is null or captured_at>clock_timestamp()+interval '5 minutes' or captured_at<clock_timestamp()-interval '24 hours'
  or (capture->>'started_at')::timestamptz is null or (capture->>'started_at')::timestamptz>captured_at
  or capture->>'protocol' is distinct from 'm9-photo-category-public-capture-1'
  or capture->>'origin' is distinct from 'https://vaquerosm.com'
  or capture->'complete' is distinct from 'true'::jsonb or capture->'credentials_sent' is distinct from 'false'::jsonb
  or capture->'writes_performed' is distinct from '0'::jsonb
  or jsonb_typeof(capture->'products') is distinct from 'array'
  or (select array_agg((x->>'id')::bigint order by (x->>'id')::bigint) from jsonb_array_elements(capture->'products')x)
   is distinct from array[7981,11949,21265,35045,36300,37110,38374]::bigint[]
  then raise exception 'PHOTO_CATEGORY_STALE_OR_INCOMPLETE_CAPTURE';end if;
 if exists(select 1 from jsonb_array_elements(capture->'products')x where x->>'status' is distinct from '200' or x#>>'{data,id}' is distinct from x->>'id'
  or x->>'method' is distinct from 'GET' or x->>'url' is distinct from 'https://vaquerosm.com/wp-json/wc/store/v1/products/'||(x->>'id')||'?_fields=id,categories'
  or (x->>'observed_at')::timestamptz is null
  or jsonb_typeof(x#>'{data,categories}') is distinct from 'array' or jsonb_array_length(x#>'{data,categories}') not between 1 and 20
  or (x->>'observed_at')::timestamptz>captured_at or (x->>'observed_at')::timestamptz<(capture->>'started_at')::timestamptz)
  then raise exception 'PHOTO_CATEGORY_PUBLIC_IDENTITY_CHANGED';end if;
 if exists(select 1 from jsonb_array_elements(capture->'products')x
  where jsonb_typeof(x->'raw_json') is distinct from 'string'
   or encode(extensions.digest(x->>'raw_json','sha256'),'hex') is distinct from x->>'raw_sha256'
   or (x->>'raw_json')::jsonb is distinct from x->'data')
  then raise exception 'PHOTO_CATEGORY_RAW_CAPTURE_CHANGED';end if;
 -- Canonical paths derive only from ancestor permalinks observed among these
 -- authorized products. A missing ancestor or a changed name is a hold.
 with recursive terms as (
  select distinct c->>'id' id,c->>'name' name,c->>'slug' slug,c->>'link' link,
   regexp_replace(c->>'link','[^/]+/$','') parent_link
  from jsonb_array_elements(capture->'products')p cross join lateral jsonb_array_elements(p#>'{data,categories}')c
 ), paths as (
  select id,name,link,parent_link,name path from terms where parent_link='https://vaquerosm.com/product-category/'
  union all select t.id,t.name,t.link,t.parent_link,p.path||' > '||t.name from terms t join paths p on p.link=t.parent_link
 ) select jsonb_agg(jsonb_build_object('id',id::bigint,'path',path)order by id::bigint),count(*) into canonical_paths,category_count from paths;
 if category_count is distinct from (select count(distinct c->>'id') from jsonb_array_elements(capture->'products')p
    cross join lateral jsonb_array_elements(p#>'{data,categories}')c)
  or exists(select 1 from jsonb_array_elements(capture->'products')p cross join lateral jsonb_array_elements(p#>'{data,categories}')c
    where jsonb_typeof(c->'id') is distinct from 'number' or coalesce(c->>'id','') !~ '^[1-9][0-9]*$'
     or coalesce(c->>'name','')='' or c->>'name'<>btrim(c->>'name') or coalesce(c->>'slug','') !~ '^[a-z0-9%_-]+$'
     or c->>'link' is distinct from regexp_replace(c->>'link','[^/]+/$','')||(c->>'slug')||'/'
     or c->>'link' !~ '^https://vaquerosm[.]com/product-category/[a-z0-9%_/-]+/$')
  then raise exception 'PHOTO_CATEGORY_CANONICAL_PATH_NOT_PROVEN';end if;
 select * into strict refresh from app.m9_variant_photo_refreshes where request_id=(p_packet->>'refresh_id')::uuid;
 if refresh.reversed_at is not null or refresh.packet->>'protocol'<>'m9-variant-photo-refresh-1'
  or refresh.result->>'created'<>'24' or refresh.result->>'previous_evidence_revalidated'<>'25'
  or encode(extensions.digest(to_jsonb(refresh)::text,'sha256'),'hex') is distinct from p_packet->>'expected_receipt_sha256'
  then raise exception 'PHOTO_CATEGORY_REFRESH_RECEIPT_CHANGED';end if;
 select array_agg((x->>'product_id')::uuid order by x->>'product_id') into ids from jsonb_array_elements(refresh.packet->'families')x;
 if (select array_agg(x->>'product_id' order by x->>'product_id') from jsonb_array_elements(p_packet->'expected_current')x)
   is distinct from (select array_agg(x->>'product_id' order by x->>'product_id') from jsonb_array_elements(refresh.packet->'families')x)
  or (select count(distinct x->>'product_id') from jsonb_array_elements(p_packet->'mappings')x)<>7
  then raise exception 'PHOTO_CATEGORY_FIXED_TARGETS_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 lock table public.products in exclusive mode;
 lock table public.variants,public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,
  app.m9_rows,app.m9_products,app.web_content_sources,app.web_product_drafts,app.web_variant_photo_evidence,
  app.web_variant_photo_storage,app.web_category_bindings,app.m9_photo_category_reviews in share row exclusive mode;
 select * into strict refresh from app.m9_variant_photo_refreshes where request_id=(p_packet->>'refresh_id')::uuid for share;
 if refresh.reversed_at is not null or encode(extensions.digest(to_jsonb(refresh)::text,'sha256'),'hex') is distinct from p_packet->>'expected_receipt_sha256'
  then raise exception 'PHOTO_CATEGORY_REFRESH_RECEIPT_CHANGED';end if;
 perform o.id from storage.objects o where o.bucket_id='product-images' and o.id in(select (obj->>'id')::uuid
  from jsonb_array_elements(p_packet->'expected_current')x cross join lateral jsonb_array_elements(x->'objects')obj)order by o.id for share;
 select * into review from app.m9_photo_category_reviews where request_id=rid;
 if found then
  if review.packet_sha256<>packet_hash or review.reversed_at is not null or app.m9_variant_photo_refresh_state(ids) is distinct from review.after_state
   then raise exception 'PHOTO_CATEGORY_REPLAY_CHANGED';end if;
  return review.result||jsonb_build_object('replayed',true);
 end if;
 if exists(select 1 from app.m9_photo_category_reviews where refresh_id=refresh.request_id)
  then raise exception 'PHOTO_CATEGORY_REFRESH_ALREADY_REVIEWED';end if;
 before_state:=app.m9_variant_photo_refresh_state(ids);
 if before_state is distinct from p_packet->'expected_current' then raise exception 'PHOTO_CATEGORY_CURRENT_CONTEXT_CHANGED';end if;
 for f in select value from jsonb_array_elements(before_state) order by value->>'product_id' loop
  select value into old_f from jsonb_array_elements(refresh.before_state)where value->>'product_id'=f->>'product_id';
  select value into after_f from jsonb_array_elements(refresh.after_state)where value->>'product_id'=f->>'product_id';
  select value into fp from jsonb_array_elements(refresh.packet->'families')where value->>'product_id'=f->>'product_id';
  if old_f is null or after_f is null or fp is null
   or (f-array['copies','objects','category_binding']) is distinct from (after_f-array['copies','objects','category_binding'])
   then raise exception 'PHOTO_CATEGORY_NOT_ONLY_EXPECTED_PHOTO_REFRESH';end if;
  select * into strict b from app.web_category_bindings where product_id=(f->>'product_id')::uuid;
  select * into strict source from app.web_content_sources where product_id=b.product_id;
  select * into strict draft from app.web_product_drafts where product_id=b.product_id;
  if to_jsonb(b) is distinct from after_f->'category_binding' or b.invalidated_at is null or b.invalidation_reason<>'SOURCE_CHANGED'
   or (old_f#>>'{category_binding,invalidated_at}') is not null
   or (to_jsonb(b)-array['invalidated_at','invalidation_reason']) is distinct from ((old_f->'category_binding')-array['invalidated_at','invalidation_reason'])
   or b.woo_product_id::text is distinct from fp->>'woo_product_id' or source.snapshot->>'source_status'<>'publish'
   or source.snapshot->>'type'<>'variable' or source.snapshot->>'woo_product_id' is distinct from b.woo_product_id::text
   or not exists(select 1 from app.m9_products m where m.product_id=b.product_id and m.woo_id=b.woo_product_id)
   then raise exception 'PHOTO_CATEGORY_INVALIDATION_NOT_FROM_REFRESH';end if;
  select value into mapping from jsonb_array_elements(p_packet->'mappings') where value->>'product_id'=f->>'product_id';
  select value into product from jsonb_array_elements(capture->'products') where value->>'id'=b.woo_product_id::text;
  if mapping->>'woo_product_id' is distinct from b.woo_product_id::text or mapping->'mappings' is distinct from b.mappings
   or b.category_paths is distinct from draft.content->'categories' or b.category_paths is distinct from source.suggested_content->'categories'
   or (select array_agg((x->>'id')::bigint order by (x->>'id')::bigint) from jsonb_array_elements(product#>'{data,categories}')x)
     is distinct from (select array_agg((x->>'id')::bigint order by (x->>'id')::bigint) from jsonb_array_elements(b.mappings)x)
   or exists(select 1 from jsonb_array_elements(b.mappings)m where not exists(select 1 from jsonb_array_elements(canonical_paths)c where c=m))
   then raise exception 'PHOTO_CATEGORY_CURRENT_MEMBERSHIP_CHANGED';end if;
  perform app.validate_web_content(draft.content);
  if jsonb_array_length(f->'copies')<>jsonb_array_length(f->'evidence')
   or exists(select 1 from public.variants v left join app.m9_rows r on r.variant_id=v.id where v.product_id=b.product_id
    and (r.variant_id is null or r.source_row is distinct from app.m9_rehearsal_current_row(v.id)))
   then raise exception 'PHOTO_CATEGORY_CANONICAL_CATALOG_CHANGED';end if;
  for e in select * from app.web_variant_photo_evidence where product_id=b.product_id order by variant_id loop
   select * into strict photo_copy from app.web_variant_photo_storage where variant_id=e.variant_id;
   select jsonb_agg(jsonb_build_object('url','https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/'||
    e.product_id::text||'/'||(x->>'sha256')||'.'||case x->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end,
    'alt',x->>'alt')order by n)into wanted from jsonb_array_elements(e.photos)with ordinality a(x,n);
   if e.source_fingerprint<>md5(to_jsonb(source)::text) or e.catalog_fingerprint<>md5((f->'catalog')::text)
    or photo_copy.evidence_hash<>md5(to_jsonb(e)::text) or photo_copy.photos is distinct from wanted
    or not exists(select 1 from public.variants v join public.barcodes bc on bc.variant_id=v.id and bc.source='SICAR' and bc.is_primary
      where v.id=e.variant_id and v.product_id=e.product_id and v.is_active and bc.code=e.barcode
       and v.woocommerce_product_id=e.woo_product_id and v.woocommerce_variation_id=e.woo_variation_id)
    or exists(select 1 from jsonb_array_elements(e.photos)x where not exists(select 1 from storage.objects o where o.bucket_id='product-images'
      and o.name=e.product_id::text||'/'||(x->>'sha256')||'.'||case x->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end
      and o.metadata->>'size'=x->>'bytes' and o.metadata->>'mimetype'=x->>'mime'))
    then raise exception 'PHOTO_CATEGORY_NEW_PHOTO_LINK_NOT_EXACT';end if;
  end loop;
  update app.web_category_bindings set source_sha256=source.source_sha256,source_fingerprint=md5(source.snapshot::text),
   evidence_sha256=p_packet->>'capture_sha256',verified_at=captured_at,invalidated_at=null,invalidation_reason=null where product_id=b.product_id;
  if not coalesce((app.web_category_binding_state(b.product_id)->>'valid')::boolean,false)
   then raise exception 'PHOTO_CATEGORY_REVIEW_NOT_VALID';end if;
  reverified:=reverified+1;
 end loop;
 after_state:=app.m9_variant_photo_refresh_state(ids);
 insert into app.m9_photo_category_reviews(request_id,refresh_id,packet_sha256,packet,before_state,after_state,result)
 values(rid,refresh.request_id,packet_hash,p_packet,before_state,after_state,jsonb_build_object('request_id',rid,'reverified',reverified,
  'captured_at',captured_at,'technical_only',true,'publication_authorized',false,'send_allowed',false,'replayed',false))returning * into review;
 insert into public.audit_log(action,entity_type,entity_id,metadata)values('m9.web_categories.review_variant_photo_refresh','migration',rid::text,
  jsonb_build_object('refresh_id',refresh.request_id,'reverified',reverified,'capture_sha256',p_packet->>'capture_sha256','captured_at',captured_at,
   'source_modified',false,'draft_modified',false,'woo_modified',false,'inventory_modified',false,'publication_authorized',false));
 return review.result;
end $$;
revoke all on function app.m9_review_categories_after_photo_refresh(jsonb)from public,anon,authenticated,service_role;

create function app.m9_reverse_photo_category_review(rid uuid)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare review app.m9_photo_category_reviews;ids uuid[];f jsonb;b jsonb;
begin
 if current_user<>'postgres' then raise insufficient_privilege;end if;
 perform app.assert_sicar_staging_enabled();perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 lock table public.products in exclusive mode;
 lock table public.variants,public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,
  app.m9_rows,app.m9_products,app.web_content_sources,app.web_product_drafts,app.web_variant_photo_evidence,
  app.web_variant_photo_storage,app.web_category_bindings,app.m9_photo_category_reviews in share row exclusive mode;
 select * into strict review from app.m9_photo_category_reviews where request_id=rid;
 if review.reversed_at is not null then raise exception 'PHOTO_CATEGORY_ALREADY_REVERSED';end if;
 select array_agg((x->>'product_id')::uuid)into ids from jsonb_array_elements(review.after_state)x;
 perform o.id from storage.objects o where o.id in(select(obj->>'id')::uuid from jsonb_array_elements(review.after_state)x
  cross join lateral jsonb_array_elements(x->'objects')obj)order by o.id for share;
 if app.m9_variant_photo_refresh_state(ids) is distinct from review.after_state then raise exception 'PHOTO_CATEGORY_REVERSAL_CHANGED';end if;
 for f in select value from jsonb_array_elements(review.before_state) loop
  b:=f->'category_binding';
  update app.web_category_bindings set source_sha256=b->>'source_sha256',source_fingerprint=b->>'source_fingerprint',evidence_sha256=b->>'evidence_sha256',
   mappings=b->'mappings',category_paths=b->'category_paths',verified_at=(b->>'verified_at')::timestamptz,
   invalidated_at=(b->>'invalidated_at')::timestamptz,invalidation_reason=b->>'invalidation_reason' where product_id=(b->>'product_id')::uuid;
 end loop;
 update app.m9_photo_category_reviews set reversed_at=now()where request_id=rid;
 insert into public.audit_log(action,entity_type,entity_id,metadata)values('m9.web_categories.reverse_variant_photo_review','migration',rid::text,
  jsonb_build_object('held_restored',7,'source_modified',false,'draft_modified',false,'woo_modified',false,'inventory_modified',false));
 return jsonb_build_object('request_id',rid,'held_restored',7,'woo_modified',false);
end $$;
revoke all on function app.m9_reverse_photo_category_review(uuid)from public,anon,authenticated,service_role;

commit;
