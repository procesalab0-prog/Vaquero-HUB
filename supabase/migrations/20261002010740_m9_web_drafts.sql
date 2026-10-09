begin;

-- Editorial preparation only. No outbox, Woo client, inventory or barcode writes.
create table app.web_content_sources (
  product_id uuid primary key references public.products(id),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null,
  suggested_content jsonb not null,
  imported_at timestamptz not null default now()
);
create table app.web_product_drafts (
  product_id uuid primary key references public.products(id),
  content jsonb not null,
  revision integer not null check (revision > 0),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now()
);
create table app.web_draft_requests (
  actor_id uuid not null references public.app_users(id),
  request_id uuid not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id, request_id)
);
alter table app.web_content_sources enable row level security;
alter table app.web_product_drafts enable row level security;
alter table app.web_draft_requests enable row level security;
revoke all on app.web_content_sources,app.web_product_drafts,app.web_draft_requests from public,anon,authenticated,service_role;

create function app.validate_web_content(c jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare item jsonb; k text;
begin
 if c is null or jsonb_typeof(c)<>'object' or octet_length(c::text)>180000 then raise exception 'INVALID_WEB_CONTENT'; end if;
 if (select count(*) from jsonb_object_keys(c))<>6 or not(c ?& array['name','base_code','description','short_description','images','categories']) then raise exception 'INVALID_WEB_CONTENT'; end if;
 foreach k in array array['name','base_code','description','short_description'] loop
   if jsonb_typeof(c->k)<>'string' then raise exception 'INVALID_WEB_CONTENT'; end if;
 end loop;
 if length(btrim(c->>'name')) not between 1 and 240 or length(c->>'base_code')>160
   or length(c->>'description')>30000 or length(c->>'short_description')>4000 then raise exception 'INVALID_WEB_CONTENT'; end if;
 if jsonb_typeof(c->'images')<>'array' or jsonb_array_length(c->'images')>20
   or jsonb_typeof(c->'categories')<>'array' or jsonb_array_length(c->'categories')>20 then raise exception 'INVALID_WEB_CONTENT'; end if;
 for item in select value from jsonb_array_elements(c->'images') loop
   if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2
      or not(item ?& array['url','alt']) or jsonb_typeof(item->'url')<>'string' or jsonb_typeof(item->'alt')<>'string'
      or length(item->>'url')>2000 or length(item->>'alt')>240
      -- Images are references, never fetched by the server. Restrict to commercial hosts.
      or (item->>'url') !~ '^https://(vaquerosm\.com/wp-content/uploads/|zsezjtswqeijboezvado\.supabase\.co/storage/v1/object/public/product-images/)[A-Za-z0-9%._~!$&''()*+,;=:@/?#-]+$'
      then raise exception 'INVALID_WEB_IMAGE'; end if;
 end loop;
 if (select count(distinct value->>'url') from jsonb_array_elements(c->'images'))<>jsonb_array_length(c->'images') then raise exception 'DUPLICATE_WEB_IMAGE'; end if;
 for item in select value from jsonb_array_elements(c->'categories') loop
   if jsonb_typeof(item)<>'string' or length(btrim(item#>>'{}')) not between 1 and 240 then raise exception 'INVALID_WEB_CATEGORY'; end if;
 end loop;
end $$;
revoke all on function app.validate_web_content(jsonb) from public,anon,authenticated,service_role;

create function app.web_catalog_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('product_id',p.id,'name',p.name,'image_path',p.image_path,'active',p.is_active,
 'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,
   'barcode',(select b.code from public.barcodes b where b.variant_id=v.id and b.is_primary),
   'price_cents',v.price_cents,'active',v.is_active,'woo_product_id',v.woocommerce_product_id,
   'woo_variation_id',v.woocommerce_variation_id,
   'department',d.department,'section',d.section,
   'attributes',coalesce((select jsonb_object_agg(a.type_code,a.value) from public.variant_attributes va
     join public.attribute_values a on a.id=va.value_id where va.variant_id=v.id),'{}'::jsonb)) order by v.id)
 from public.variants v left join public.m9_variant_details d on d.variant_id=v.id where v.product_id=p.id),'[]'::jsonb))
 from public.products p where p.id=p_id
$$;
revoke all on function app.web_catalog_snapshot(uuid) from public,anon,authenticated,service_role;

create function app.read_web_draft(p_product_id uuid default null,p_variant_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pid uuid:=p_product_id; catalog jsonb; draft app.web_product_drafts; src app.web_content_sources; editable boolean;
begin
 if auth.uid() is null or not app.has_perm('products.read') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 perform app.assert_sicar_staging_enabled();
 if pid is null then select product_id into pid from public.variants where id=p_variant_id; end if;
 catalog:=app.web_catalog_snapshot(pid);
 if catalog is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
 select * into draft from app.web_product_drafts where product_id=pid;
 select * into src from app.web_content_sources where product_id=pid;
 editable:=app.has_perm('products.update') or (app.has_perm('products.create') and exists(select 1 from public.products where id=pid and created_by=auth.uid()));
 return jsonb_build_object('catalog',catalog,'fingerprint',md5(catalog::text),'revision',coalesce(draft.revision,0),
  'can_edit',editable,'saved',draft.product_id is not null,'updated_at',draft.updated_at,
  'content',coalesce(draft.content,src.suggested_content,jsonb_build_object('name',catalog->>'name','base_code','','description','','short_description','','images','[]'::jsonb,'categories','[]'::jsonb)),
  'source',case when src.product_id is null then null else jsonb_build_object('sha256',src.source_sha256,
    'woo_product_id',src.snapshot->'woo_product_id','source_status',src.snapshot->'source_status',
    'unselected_woo_variation_ids',src.snapshot->'unselected_woo_variation_ids','variants',src.snapshot->'variants') end,
  'woo_writes_enabled',false);
end $$;
revoke all on function app.read_web_draft(uuid,uuid) from public,anon,service_role;
grant execute on function app.read_web_draft(uuid,uuid) to authenticated;
create function public.read_web_draft(p_product_id uuid default null,p_variant_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select app.read_web_draft(p_product_id,p_variant_id) $$;
revoke all on function public.read_web_draft(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_web_draft(uuid,uuid) to authenticated;

create function app.save_web_draft(p_product_id uuid,p_content jsonb,p_revision integer,p_fingerprint text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); old app.web_product_drafts; prior app.web_draft_requests; h text; result jsonb; r integer; catalog jsonb;
begin
 if actor is null or not app.has_perm('products.read') or not (app.has_perm('products.update') or
   (app.has_perm('products.create') and exists(select 1 from public.products where id=p_product_id and created_by=actor))) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 perform app.assert_sicar_staging_enabled();
 perform app.validate_web_content(p_content);
 if p_request_id is null or p_revision is null or p_revision<0 then raise exception 'INVALID_WEB_REQUEST'; end if;
 h:=md5(jsonb_build_array('save',p_product_id,p_content,p_revision,p_fingerprint)::text);
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 select * into prior from app.web_draft_requests where actor_id=actor and request_id=p_request_id;
 if found then
   if prior.payload_hash<>h then raise exception 'WEB_REQUEST_REUSED'; end if;
   return prior.result;
 end if;
 perform 1 from public.products where id=p_product_id for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 catalog:=app.web_catalog_snapshot(p_product_id);
 if p_fingerprint is distinct from md5(catalog::text) then raise exception 'WEB_CATALOG_CHANGED'; end if;
 select * into old from app.web_product_drafts where product_id=p_product_id for update;
 if coalesce(old.revision,0)<>p_revision then raise exception 'WEB_DRAFT_CHANGED'; end if;
 r:=case when old.content=p_content then old.revision else coalesce(old.revision,0)+1 end;
 if old.content is distinct from p_content then
   insert into app.web_product_drafts(product_id,content,revision,updated_by) values(p_product_id,p_content,r,actor)
   on conflict(product_id) do update set content=excluded.content,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now();
   insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.web_draft.save','product',p_product_id,
     jsonb_build_object('actor',actor,'revision',r,'before',old.content,'after',p_content,'woo_written',false));
 end if;
 result:=jsonb_build_object('product_id',p_product_id,'revision',r,'woo_written',false);
 insert into app.web_draft_requests(actor_id,request_id,payload_hash,result) values(actor,p_request_id,h,result);
 return result;
end $$;
revoke all on function app.save_web_draft(uuid,jsonb,integer,text,uuid) from public,anon,service_role;
grant execute on function app.save_web_draft(uuid,jsonb,integer,text,uuid) to authenticated;
create function public.save_web_draft(p_product_id uuid,p_content jsonb,p_revision integer,p_fingerprint text,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app.save_web_draft(p_product_id,p_content,p_revision,p_fingerprint,p_request_id) $$;
revoke all on function public.save_web_draft(uuid,jsonb,integer,text,uuid) from public,anon,service_role;
grant execute on function public.save_web_draft(uuid,jsonb,integer,text,uuid) to authenticated;

-- Atomic creation: an invalid web draft rolls back the catalog creation too.
create function app.create_product_with_web_draft(p_name text,p_category_id uuid,p_variants jsonb,p_brand_name text,p_content jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); h text; prior app.web_draft_requests; result jsonb; pid uuid;
begin
 if actor is null or not app.has_perm('products.create') or not app.has_perm('products.read') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 perform app.assert_sicar_staging_enabled();
 perform app.validate_web_content(p_content);
 if p_request_id is null then raise exception 'INVALID_WEB_REQUEST'; end if;
 h:=md5(jsonb_build_array('create',p_name,p_category_id,p_variants,p_brand_name,p_content)::text);
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 select * into prior from app.web_draft_requests where actor_id=actor and request_id=p_request_id;
 if found then
   if prior.payload_hash<>h then raise exception 'WEB_REQUEST_REUSED'; end if;
   return prior.result;
 end if;
 result:=public.create_catalog_product(p_name,p_category_id,p_variants,p_brand_name=>p_brand_name);
 pid:=(result->>'product_id')::uuid;
 insert into app.web_product_drafts(product_id,content,revision,updated_by) values(pid,p_content,1,actor);
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.web_draft.save','product',pid,
   jsonb_build_object('actor',actor,'revision',1,'after',p_content,'woo_written',false));
 result:=result||jsonb_build_object('revision',1,'woo_written',false);
 insert into app.web_draft_requests(actor_id,request_id,payload_hash,result) values(actor,p_request_id,h,result);
 return result;
end $$;
revoke all on function app.create_product_with_web_draft(text,uuid,jsonb,text,jsonb,uuid) from public,anon,service_role;
grant execute on function app.create_product_with_web_draft(text,uuid,jsonb,text,jsonb,uuid) to authenticated;
create function public.create_product_with_web_draft(p_name text,p_category_id uuid,p_variants jsonb,p_brand_name text,p_content jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app.create_product_with_web_draft(p_name,p_category_id,p_variants,p_brand_name,p_content,p_request_id) $$;
revoke all on function public.create_product_with_web_draft(text,uuid,jsonb,text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.create_product_with_web_draft(text,uuid,jsonb,text,jsonb,uuid) to authenticated;
commit;
