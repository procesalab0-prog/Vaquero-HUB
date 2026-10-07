begin;
create table app.web_variant_photo_evidence (
 variant_id uuid primary key references public.variants(id),
 product_id uuid not null references public.products(id),
 barcode text not null unique,
 woo_product_id bigint not null,
 woo_variation_id bigint not null unique,
 export_sha256 text not null check(export_sha256 ~ '^[a-f0-9]{64}$'),
 source_variant jsonb not null,
 photos jsonb not null,
 supplemental boolean not null,
 catalog_fingerprint text not null,
 source_fingerprint text not null,
 revision integer not null default 1,
 created_at timestamptz not null default now()
);
alter table app.web_variant_photo_evidence enable row level security;
revoke all on app.web_variant_photo_evidence from public,anon,authenticated,service_role;

-- Supervised import only. Neither client nor service_role can call this.
create function app.import_variant_photo_evidence(pid uuid,catalog_hash text,
 source_hash text,draft_hash text,export_hash text,items jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s app.web_content_sources; d app.web_product_drafts; catalog jsonb;
 item jsonb; v jsonb; photo jsonb; saved app.web_variant_photo_evidence;
 extra boolean; created integer:=0; unchanged integer:=0;
begin
 perform app.assert_sicar_staging_enabled();
 if current_user<>'postgres' then raise insufficient_privilege; end if;
 if export_hash is null or export_hash !~ '^[a-f0-9]{64}$'
  or items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 200
  then raise exception 'INVALID_VARIANT_PHOTO_PACKET'; end if;
 perform 1 from public.products where id=pid for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 perform 1 from public.variants where product_id=pid order by id for update;
 select * into strict s from app.web_content_sources where product_id=pid for update;
 select * into d from app.web_product_drafts where product_id=pid for update;
 catalog:=app.web_catalog_snapshot(pid);
 if md5(catalog::text) is distinct from catalog_hash
  or md5(to_jsonb(s)::text) is distinct from source_hash
  or md5(coalesce(to_jsonb(d),'null'::jsonb)::text) is distinct from draft_hash
  then raise exception 'VARIANT_PHOTO_EXPECTATION_CHANGED'; end if;
 if s.snapshot->>'source_status'<>'publish' or not exists(select 1 from app.m9_products m
  where m.product_id=pid and m.woo_id::text=s.snapshot->>'woo_product_id')
  then raise exception 'VARIANT_PHOTO_SOURCE_LINK_REVIEW'; end if;
 if (select count(distinct x->>'variant_id') from jsonb_array_elements(items) x)<>jsonb_array_length(items)
  then raise exception 'DUPLICATE_VARIANT_PHOTO_ITEM'; end if;
 for item in select value from jsonb_array_elements(items) loop
  select value into v from jsonb_array_elements(catalog->'variants') where value->>'id'=item->>'variant_id';
  if v is null or v->>'barcode' is distinct from item->>'barcode'
   or v->>'woo_product_id' is distinct from item->>'woo_product_id'
   or v->>'woo_variation_id' is distinct from item->>'woo_variation_id'
   or v->>'woo_product_id' is distinct from s.snapshot->>'woo_product_id'
   or v->>'woo_variation_id' is null or v->>'active'<>'true'
   or item#>>'{source_variant,id}' is distinct from v->>'woo_variation_id'
   or item#>>'{source_variant,status}' is distinct from 'publish'
   or jsonb_typeof(item->'source_variant') is distinct from 'object'
   or not(item->'source_variant' ?& array['id','status','attributes','images'])
   or (select count(*) from jsonb_object_keys(item->'source_variant'))<>4
   or jsonb_typeof(item#>'{source_variant,attributes}') is distinct from 'array'
   or jsonb_typeof(item#>'{source_variant,images}') is distinct from 'string'
   then raise exception 'VARIANT_PHOTO_IDENTITY_REVIEW'; end if;
  if jsonb_typeof(item->'photos') is distinct from 'array' or jsonb_array_length(item->'photos')>20
   or (select count(distinct x->>'url') from jsonb_array_elements(item->'photos') x)<>jsonb_array_length(item->'photos')
   then raise exception 'INVALID_VARIANT_PHOTOS'; end if;
  for photo in select value from jsonb_array_elements(item->'photos') loop
   if jsonb_typeof(photo) is distinct from 'object' or (select count(*) from jsonb_object_keys(photo))<>5
    or not(photo ?& array['url','sha256','bytes','mime','alt'])
    or coalesce(photo->>'url','') !~ '^https://vaquerosm[.]com/wp-content/uploads/[A-Za-z0-9%._~!$&''()*+,;=:@/-]+$'
    or length(photo->>'url')>2000 or coalesce(photo->>'sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(photo->>'bytes','') !~ '^[0-9]{1,7}$' or (photo->>'bytes')::integer not between 1 and 4194304
    or coalesce(photo->>'mime','') not in ('image/jpeg','image/png','image/webp')
    or jsonb_typeof(photo->'alt') is distinct from 'string' or length(photo->>'alt')>240
    then raise exception 'INVALID_VARIANT_PHOTO_BYTES_EVIDENCE'; end if;
  end loop;
  if coalesce((select string_agg(x->>'url',', ' order by n) from jsonb_array_elements(item->'photos') with ordinality p(x,n)),'')
   is distinct from item#>>'{source_variant,images}' then raise exception 'VARIANT_PHOTO_SOURCE_URL_CHANGED'; end if;
  extra:=not exists(select 1 from jsonb_array_elements(s.snapshot->'variants') x
    where x->>'barcode'=v->>'barcode' and x->>'woo_variation_id'=v->>'woo_variation_id');
  select * into saved from app.web_variant_photo_evidence where variant_id=(v->>'id')::uuid for update;
  if found then
   if saved.product_id<>pid or saved.barcode<>v->>'barcode' or saved.woo_product_id<>(v->>'woo_product_id')::bigint
    or saved.woo_variation_id<>(v->>'woo_variation_id')::bigint or saved.photos is distinct from item->'photos'
    or saved.source_variant is distinct from item->'source_variant' or saved.export_sha256<>export_hash
    or saved.catalog_fingerprint<>catalog_hash or saved.source_fingerprint<>source_hash
    then raise exception 'VARIANT_PHOTO_ALREADY_EDITED'; end if;
   unchanged:=unchanged+1;
  else
   insert into app.web_variant_photo_evidence(variant_id,product_id,barcode,woo_product_id,woo_variation_id,
    export_sha256,source_variant,photos,supplemental,catalog_fingerprint,source_fingerprint)
   values((v->>'id')::uuid,pid,v->>'barcode',(v->>'woo_product_id')::bigint,(v->>'woo_variation_id')::bigint,
    export_hash,item->'source_variant',item->'photos',extra,catalog_hash,source_hash);
   created:=created+1;
  end if;
 end loop;
 if created>0 then insert into public.audit_log(action,entity_type,entity_id,metadata)
  values('m9.variant_photos.import_evidence','product',pid,jsonb_build_object('created',created,
   'export_sha256',export_hash,'source_fingerprint',source_hash,'catalog_fingerprint',catalog_hash,
   'inventory_modified',false,'woo_modified',false)); end if;
 return jsonb_build_object('created',created,'unchanged',unchanged,'woo_modified',false);
end $$;
revoke all on function app.import_variant_photo_evidence(uuid,text,text,text,text,jsonb) from public,anon,authenticated,service_role;

-- Explicit permission check is required because the evidence table is private.
create function app.read_variant_photos(ids uuid[])
returns table(variant_id uuid,product_id uuid,photos jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app.has_perm('products.read') then raise insufficient_privilege; end if;
 perform app.assert_sicar_staging_enabled();
 if ids is null or cardinality(ids)>200 then raise exception 'INVALID_VARIANT_BATCH'; end if;
 return query select e.variant_id,e.product_id,e.photos from app.web_variant_photo_evidence e
 join public.variants v on v.id=e.variant_id and v.product_id=e.product_id
 join public.barcodes b on b.variant_id=v.id and b.is_primary and b.code=e.barcode
 join app.m9_products m on m.product_id=e.product_id and m.woo_id=e.woo_product_id
 join app.web_content_sources s on s.product_id=e.product_id and md5(to_jsonb(s)::text)=e.source_fingerprint
 where e.variant_id=any(ids) and v.is_active
  and v.woocommerce_product_id=e.woo_product_id and v.woocommerce_variation_id=e.woo_variation_id;
end $$;
revoke all on function app.read_variant_photos(uuid[]) from public,anon,service_role;
grant execute on function app.read_variant_photos(uuid[]) to authenticated;
create function public.read_variant_photos(ids uuid[])
returns table(variant_id uuid,product_id uuid,photos jsonb)
language sql stable security invoker set search_path='' as $$ select * from app.read_variant_photos(ids) $$;
revoke all on function public.read_variant_photos(uuid[]) from public,anon,service_role;
grant execute on function public.read_variant_photos(uuid[]) to authenticated;
commit;
