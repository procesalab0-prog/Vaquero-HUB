begin;
create table app.web_variant_photo_storage (
 variant_id uuid primary key references app.web_variant_photo_evidence(variant_id),
 evidence_hash text not null,
 photos jsonb not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table app.web_variant_photo_storage enable row level security;
revoke all on app.web_variant_photo_storage from public,anon,authenticated,service_role;

create function app.variant_photo_copy_context(pid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; live_count integer;
begin
 if auth.uid() is null or not app.has_perm('products.update') then raise insufficient_privilege; end if;
 perform app.assert_sicar_staging_enabled();
 select count(*) into live_count from app.read_variant_photos(array(select e.variant_id from app.web_variant_photo_evidence e where e.product_id=pid));
 if live_count=0 or live_count<>(select count(*) from app.web_variant_photo_evidence where product_id=pid)
  then raise exception 'VARIANT_PHOTO_SOURCE_REVIEW'; end if;
 select jsonb_agg(jsonb_build_object('variant_id',e.variant_id,'barcode',e.barcode,'photos',e.photos,
  'evidence_hash',md5(to_jsonb(e)::text),'stored',s.photos) order by e.variant_id)
 into rows from app.web_variant_photo_evidence e left join app.web_variant_photo_storage s using(variant_id) where e.product_id=pid;
 return jsonb_build_object('product_id',pid,'catalog_hash',md5(app.web_catalog_snapshot(pid)::text),'items',rows,
  'evidence_hash',(select md5(jsonb_agg(to_jsonb(e) order by variant_id)::text) from app.web_variant_photo_evidence e where product_id=pid));
end $$;
revoke all on function app.variant_photo_copy_context(uuid) from public,anon,service_role;
grant execute on function app.variant_photo_copy_context(uuid) to authenticated;
create function public.variant_photo_copy_context(pid uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select app.variant_photo_copy_context(pid) $$;
revoke all on function public.variant_photo_copy_context(uuid) from public,anon,service_role;
grant execute on function public.variant_photo_copy_context(uuid) to authenticated;

create function app.save_variant_photo_copies(pid uuid,catalog_hash text,evidence_hash text,items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb; item jsonb; expected jsonb; p jsonb; image jsonb; path text; ext text;
 saved app.web_variant_photo_storage; created integer:=0; unchanged integer:=0;
begin
 if auth.uid() is null or not app.has_perm('products.update') then raise insufficient_privilege; end if;
 perform app.assert_sicar_staging_enabled();
 perform 1 from public.products where id=pid for update;
 perform 1 from public.variants where product_id=pid order by id for update;
 perform 1 from app.web_content_sources where product_id=pid for update;
 ctx:=app.variant_photo_copy_context(pid);
 if ctx->>'catalog_hash' is distinct from catalog_hash or ctx->>'evidence_hash' is distinct from evidence_hash
  then raise exception 'VARIANT_PHOTO_COPY_CHANGED'; end if;
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>200
  or jsonb_array_length(items)<>(select count(*) from jsonb_array_elements(ctx->'items') r where jsonb_array_length(r->'photos')>0)
  or (select count(distinct r->>'variant_id') from jsonb_array_elements(items) r)<>jsonb_array_length(items)
  then raise exception 'INVALID_VARIANT_PHOTO_COPY_PACKET'; end if;
 for item in select value from jsonb_array_elements(items) loop
  select value into expected from jsonb_array_elements(ctx->'items') r where r->>'variant_id'=item->>'variant_id';
  if expected is null or jsonb_typeof(item->'photos') is distinct from 'array'
   or jsonb_array_length(item->'photos')<>jsonb_array_length(expected->'photos') or jsonb_array_length(item->'photos')=0
   then raise exception 'VARIANT_PHOTO_COPY_IDENTITY'; end if;
  for p,image in select a.value,b.value from jsonb_array_elements(expected->'photos') with ordinality a
    join jsonb_array_elements(item->'photos') with ordinality b using(ordinality) loop
   ext:=case p->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
   path:=pid::text||'/'||(p->>'sha256')||'.'||ext;
   if image is distinct from jsonb_build_object('url','https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/'||path,'alt',p->>'alt')
    or not exists(select 1 from storage.objects o where o.bucket_id='product-images' and o.name=path
      and o.metadata->>'size'=p->>'bytes' and o.metadata->>'mimetype'=p->>'mime')
    then raise exception 'VARIANT_PHOTO_COPY_STORAGE_REVIEW'; end if;
  end loop;
  select * into saved from app.web_variant_photo_storage where variant_id=(item->>'variant_id')::uuid for update;
  if found then
   if saved.evidence_hash<>expected->>'evidence_hash' or saved.photos is distinct from item->'photos'
    then raise exception 'VARIANT_PHOTO_COPY_ALREADY_EDITED'; end if;
   unchanged:=unchanged+1;
  else
   insert into app.web_variant_photo_storage(variant_id,evidence_hash,photos,created_by)
    values((item->>'variant_id')::uuid,expected->>'evidence_hash',item->'photos',auth.uid());
   created:=created+1;
  end if;
 end loop;
 if created>0 then insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'m9.variant_photos.copy_storage','product',pid,jsonb_build_object('created',created,'inventory_modified',false,'woo_modified',false)); end if;
 return jsonb_build_object('created',created,'unchanged',unchanged);
end $$;
revoke all on function app.save_variant_photo_copies(uuid,text,text,jsonb) from public,anon,service_role;
grant execute on function app.save_variant_photo_copies(uuid,text,text,jsonb) to authenticated;
create function public.save_variant_photo_copies(pid uuid,catalog_hash text,evidence_hash text,items jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select app.save_variant_photo_copies(pid,catalog_hash,evidence_hash,items) $$;
revoke all on function public.save_variant_photo_copies(uuid,text,text,jsonb) from public,anon,service_role;
grant execute on function public.save_variant_photo_copies(uuid,text,text,jsonb) to authenticated;

create or replace function app.read_variant_photos(ids uuid[])
returns table(variant_id uuid,product_id uuid,photos jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app.has_perm('products.read') then raise insufficient_privilege; end if;
 perform app.assert_sicar_staging_enabled();
 if ids is null or cardinality(ids)>200 then raise exception 'INVALID_VARIANT_BATCH'; end if;
 return query select e.variant_id,e.product_id,coalesce(c.photos,e.photos) from app.web_variant_photo_evidence e
 join public.variants v on v.id=e.variant_id and v.product_id=e.product_id
 join public.barcodes b on b.variant_id=v.id and b.is_primary and b.code=e.barcode
 join app.m9_products m on m.product_id=e.product_id and m.woo_id=e.woo_product_id
 join app.web_content_sources s on s.product_id=e.product_id and md5(to_jsonb(s)::text)=e.source_fingerprint
 left join app.web_variant_photo_storage c on c.variant_id=e.variant_id and c.evidence_hash=md5(to_jsonb(e)::text)
  and not exists(select 1 from jsonb_array_elements(c.photos) i where not exists(select 1 from storage.objects o
   where o.bucket_id='product-images' and o.name=substr(i->>'url',length('https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/')+1)))
 where e.variant_id=any(ids) and v.is_active and v.woocommerce_product_id=e.woo_product_id and v.woocommerce_variation_id=e.woo_variation_id;
end $$;

create function app.list_variant_photo_copies() returns table(product_id uuid,name text,variants bigint,copied bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app.has_perm('products.update') then raise insufficient_privilege; end if;
 perform app.assert_sicar_staging_enabled();
 return query select e.product_id,p.name,count(*),count(c.variant_id)
 from app.web_variant_photo_evidence e join public.products p on p.id=e.product_id
 left join app.web_variant_photo_storage c on c.variant_id=e.variant_id and c.evidence_hash=md5(to_jsonb(e)::text)
 where jsonb_array_length(e.photos)>0 group by e.product_id,p.name order by e.product_id;
end $$;
revoke all on function app.list_variant_photo_copies() from public,anon,service_role;
grant execute on function app.list_variant_photo_copies() to authenticated;
create function public.list_variant_photo_copies() returns table(product_id uuid,name text,variants bigint,copied bigint)
language sql stable security invoker set search_path='' as $$ select * from app.list_variant_photo_copies() $$;
revoke all on function public.list_variant_photo_copies() from public,anon,service_role;
grant execute on function public.list_variant_photo_copies() to authenticated;
commit;
