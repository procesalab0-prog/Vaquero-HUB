begin;

-- M9 operator-only catalog importer. Deploy to staging first. No inventory path.
-- Unknown cost is NULL, never a fictitious zero. Existing manual RPCs keep their
-- numeric-cost validation; frontend/report handling of NULL needs release review.
alter table public.variants alter column cost_cents drop not null;

create table public.m9_variant_details (
  variant_id uuid primary key references public.variants(id),
  department text not null check (department <> ''),
  section text not null check (section <> ''),
  source_description text not null,
  wholesale_cents bigint check (wholesale_cents >= 0),
  medium_wholesale_cents bigint check (medium_wholesale_cents >= 0)
);
alter table public.m9_variant_details enable row level security;
revoke all on public.m9_variant_details from public, anon, authenticated;
grant select on public.m9_variant_details to authenticated;
create policy m9_details_read on public.m9_variant_details for select to authenticated
  using ((select app.has_perm('products.read')));

create table app.m9_products (
  woo_id bigint primary key,
  product_id uuid not null unique references public.products(id),
  section text not null,
  source_name text not null
);
create table app.m9_rows (
  barcode text primary key,
  variant_id uuid not null unique references public.variants(id),
  source_row jsonb not null,
  source_sha256 text not null
);
alter table app.m9_products enable row level security;
alter table app.m9_rows enable row level security;
revoke all on app.m9_products, app.m9_rows from public, anon, authenticated, service_role;

-- Exact live projection to detect edits made outside the importer.
create function app.m9_current_row(p_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object(
   'barcode', b.code, 'product_name', p.name,
   'woo_product_id', v.woocommerce_product_id,
   'woo_variation_id', v.woocommerce_variation_id,
   'description', d.source_description, 'department', d.department, 'section', d.section,
   'price_cents', v.price_cents, 'cost_cents', v.cost_cents,
   'attributes', coalesce((select jsonb_object_agg(a.type_code, a.value order by a.type_code)
     from public.variant_attributes va join public.attribute_values a on a.id=va.value_id
     where va.variant_id=v.id), '{}'::jsonb)
 )
 from public.variants v join public.products p on p.id=v.product_id
 join public.categories c on c.id=p.category_id
 join public.m9_variant_details d on d.variant_id=v.id
 join public.barcodes b on b.variant_id=v.id and b.source='SICAR' and b.is_primary
 where v.id=p_id and v.is_active and p.is_active and c.is_active
 and v.legacy_sicar_code is null and c.name=d.section
 and d.wholesale_cents is null and d.medium_wholesale_cents is null
$$;

create function app.m9_catalog_plan(p_rows jsonb, p_sha text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
 r jsonb; a record; oldrow app.m9_rows%rowtype; parent app.m9_products%rowtype;
 errors jsonb := '[]'; actions jsonb := '[]'; reason text; action text; token text;
begin
 if current_user <> 'postgres' then raise exception 'M9_OPERATOR_ONLY'; end if;
 if p_sha is null or p_sha !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows) is distinct from 'array'
 then raise exception 'M9_INVALID_INPUT'; end if;
 if jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'M9_INVALID_COUNT'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
   reason := null; action := 'CREATE';
   if jsonb_typeof(r) is distinct from 'object' then raise exception 'M9_INVALID_ROW'; end if;
   if (select array_agg(k order by k) from jsonb_object_keys(r) k) is distinct from
      array['attributes','barcode','cost_cents','department','description','price_cents','product_name','section','woo_product_id','woo_variation_id']::text[]
   then raise exception 'M9_UNKNOWN_OR_MISSING_FIELDS'; end if;
   if exists(select 1 from jsonb_each(r) e where e.key in ('barcode','department','description','product_name','section')
       and (jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') not between 1 and 2000 or (e.value #>> '{}') <> btrim(e.value #>> '{}')))
      or length(r->>'barcode') > 80 or length(r->>'product_name') > 160
      or r->'cost_cents' <> 'null'::jsonb
      or coalesce(r->>'price_cents','') !~ '^[0-9]{1,12}$' or (r->>'price_cents')::bigint <= 0
      or coalesce(r->>'woo_product_id','') !~ '^[1-9][0-9]{0,14}$'
      or (r->'woo_variation_id' <> 'null'::jsonb and coalesce(r->>'woo_variation_id','') !~ '^[1-9][0-9]{0,14}$')
      or jsonb_typeof(r->'attributes') is distinct from 'object'
   then raise exception 'M9_INVALID_ROW'; end if;
   if upper(r->>'department') in ('D1','C1','.','SIN DEFINIR') or upper(r->>'section') in ('D1','C1','.','SIN DEFINIR')
   then reason := 'TAXONOMY_UNRESOLVED'; end if;
   for a in select key,value from jsonb_each(r->'attributes') loop
     if a.key not in ('TALLA','COLOR','LARGO') or jsonb_typeof(a.value) <> 'string'
        or length(a.value #>> '{}') not between 1 and 80 or (a.value #>> '{}') <> btrim(a.value #>> '{}')
     then raise exception 'M9_INVALID_ATTRIBUTE'; end if;
   end loop;
   if (select count(*) from jsonb_array_elements(p_rows) x where x->>'barcode'=r->>'barcode') <> 1
   then reason := 'DUPLICATE_BARCODE'; end if;
   if exists(select 1 from jsonb_array_elements(p_rows) x where x->>'barcode'<>r->>'barcode'
     and ((x->>'woo_product_id'=r->>'woo_product_id' and x->'woo_variation_id'=r->'woo_variation_id')
       or (x->>'woo_product_id'=r->>'woo_product_id' and x->'attributes'=r->'attributes')))
   then reason := 'DUPLICATE_IDENTITY_OR_ATTRIBUTES'; end if;
   if exists(select 1 from jsonb_array_elements(p_rows) x where x->>'woo_product_id'=r->>'woo_product_id'
     and (x->>'section'<>r->>'section' or x->>'product_name'<>r->>'product_name'))
   then reason := 'INCONSISTENT_PARENT'; end if;
   if exists(select 1 from public.categories c where lower(btrim(c.name))=lower(r->>'section')
     and (c.name<>r->>'section' or not c.is_active)) then reason := 'CATEGORY_CONFLICT'; end if;
   select * into parent from app.m9_products where woo_id=(r->>'woo_product_id')::bigint;
   if found and (parent.section<>r->>'section' or parent.source_name<>r->>'product_name')
   then reason := 'PARENT_CHANGE_REQUIRES_REVIEW'; end if;
   if parent.product_id is null and exists(select 1 from public.variants v where v.woocommerce_product_id=(r->>'woo_product_id')::bigint)
   then reason := 'UNMANAGED_WOO_PARENT'; end if;
   select * into oldrow from app.m9_rows where barcode=r->>'barcode';
   if found then
     if app.m9_current_row(oldrow.variant_id) is distinct from oldrow.source_row then reason := 'DESTINATION_MODIFIED'; end if;
     if (r - array['price_cents','description','department']) is distinct from (oldrow.source_row - array['price_cents','description','department'])
     then reason := 'IDENTITY_CHANGE_REQUIRES_REVIEW'; end if;
     action := case when r=oldrow.source_row then 'UNCHANGED' else 'UPDATE' end;
   else
     if exists(select 1 from public.barcodes b where b.code=r->>'barcode')
       or exists(select 1 from public.variants v where v.legacy_sicar_code=r->>'barcode') then reason := 'BARCODE_ALREADY_ASSIGNED'; end if;
     if exists(select 1 from public.variants v where v.woocommerce_variation_id=(r->>'woo_variation_id')::bigint)
     then reason := 'WOO_VARIANT_ALREADY_ASSIGNED'; end if;
     if parent.product_id is null and exists(select 1 from public.products p where p.search_name=lower(translate(r->>'product_name','ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))
     then reason := 'EXISTING_NAME_REQUIRES_IDENTITY_REVIEW'; end if;
     if parent.product_id is not null and exists(select 1 from app.m9_rows s join public.variants v on v.id=s.variant_id
       where v.product_id=parent.product_id and s.source_row->'attributes'=r->'attributes')
     then reason := 'EXISTING_ATTRIBUTE_COMBINATION'; end if;
   end if;
   if reason is not null then errors:=errors||jsonb_build_array(jsonb_build_object('barcode',r->>'barcode','reason',reason)); end if;
   actions:=actions||jsonb_build_array(jsonb_build_object('barcode',r->>'barcode','action',action));
 end loop;
 -- Includes relevant live state; an accepted preview becomes stale after any catalog change.
 token := encode(extensions.digest((jsonb_build_object('rows',p_rows,'source',p_sha,
   'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.variants v),
   'products',(select jsonb_agg(to_jsonb(p) order by p.id) from public.products p),
   'barcodes',(select jsonb_agg(to_jsonb(b) order by b.id) from public.barcodes b),
   'categories',(select jsonb_agg(to_jsonb(c) order by c.id) from public.categories c),
   'attrs',(select jsonb_agg(to_jsonb(a) order by a.id) from public.attribute_values a),
   'links',(select jsonb_agg(to_jsonb(a) order by a.variant_id,a.type_code) from public.variant_attributes a),
   'details',(select jsonb_agg(to_jsonb(d) order by d.variant_id) from public.m9_variant_details d),
   'managed',(select jsonb_agg(to_jsonb(s) order by s.barcode) from app.m9_rows s)
 ))::text,'sha256'),'hex');
 return jsonb_build_object('version','m9-import-1','source_sha256',p_sha,'token',token,'errors',errors,'actions',actions,'write_allowed',jsonb_array_length(errors)=0);
end;
$$;

create function app.m9_catalog_apply(p_rows jsonb, p_sha text, p_token text) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
 plan jsonb; r jsonb; a record; oldrow app.m9_rows%rowtype;
 pid uuid; vid uuid; cid uuid; aid uuid; serial bigint; scale text;
 created integer:=0; changed integer:=0; unchanged integer:=0;
begin
 if current_user <> 'postgres' then raise exception 'M9_OPERATOR_ONLY'; end if;
 -- Coordinate ordinary catalog writes too, not just this importer. Pilot-size only.
 lock table public.products,public.variants,public.barcodes,public.categories,
   public.attribute_values,public.variant_attributes,public.m9_variant_details,
   app.m9_rows,app.m9_products in share row exclusive mode;
 plan:=app.m9_catalog_plan(p_rows,p_sha);
 if p_token is distinct from plan->>'token' then raise exception 'M9_STALE_PREVIEW'; end if;
 if not (plan->>'write_allowed')::boolean then raise exception 'M9_REVIEW_REQUIRED' using detail=(plan->'errors')::text; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
   select * into oldrow from app.m9_rows where barcode=r->>'barcode';
   if found then
     if oldrow.source_row=r then unchanged:=unchanged+1; continue; end if;
     update public.variants set price_cents=(r->>'price_cents')::bigint where id=oldrow.variant_id;
     update public.m9_variant_details set source_description=r->>'description',department=r->>'department' where variant_id=oldrow.variant_id;
     update app.m9_rows set source_row=r,source_sha256=p_sha where barcode=r->>'barcode';
     insert into public.audit_log(action,entity_type,entity_id,metadata)
       values('m9.catalog.update','variant',oldrow.variant_id,jsonb_build_object('source_sha256',p_sha,'before',oldrow.source_row,'after',r,'operator',current_user));
     changed:=changed+1; continue;
   end if;
   select product_id into pid from app.m9_products where woo_id=(r->>'woo_product_id')::bigint;
   if pid is null then
     select id into cid from public.categories where name=r->>'section';
     if cid is null then
       insert into public.categories(name) values(r->>'section') returning id into cid;
     end if;
     insert into public.products(name,category_id) values(r->>'product_name',cid) returning id into pid;
     insert into app.m9_products values((r->>'woo_product_id')::bigint,pid,r->>'section',r->>'product_name');
   end if;
   serial:=nextval('app.variant_serial_seq');
   insert into public.variants(product_id,sku,cost_cents,price_cents,woocommerce_product_id,woocommerce_variation_id)
     values(pid,serial::text||'-'||app.luhn_check_digit(serial::text),null,(r->>'price_cents')::bigint,
       (r->>'woo_product_id')::bigint,(r->>'woo_variation_id')::bigint) returning id into vid;
   -- A literal source scale preserves values without equating M/G or guessing a size system.
   scale:='M9_'||md5(r->>'section');
   if r->'attributes' <> '{}'::jsonb then
     insert into public.size_scales(code,name) values(scale,'SICAR literal: '||(r->>'section')) on conflict(code) do nothing;
   end if;
   for a in select key,value from jsonb_each_text(r->'attributes') loop
     insert into public.attribute_types(code,name) values(a.key,case a.key when 'TALLA' then 'Talla' when 'COLOR' then 'Color' when 'LARGO' then 'Largo' end) on conflict(code) do nothing;
     select id into aid from public.attribute_values where type_code=a.key and scale_code=scale and value=a.value;
     if aid is null then
       insert into public.attribute_values(type_code,scale_code,value,display_order)
         values(a.key,scale,a.value,case when a.value ~ '^[0-9]{1,4}([.][0-9]{1,2})?$' then a.value::numeric else 0 end) returning id into aid;
     end if;
     insert into public.variant_attributes values(vid,a.key,aid);
   end loop;
   insert into public.barcodes(variant_id,code,symbology,source,is_primary) values(vid,r->>'barcode','LEGACY','SICAR',true);
   insert into public.m9_variant_details(variant_id,department,section,source_description) values(vid,r->>'department',r->>'section',r->>'description');
   insert into app.m9_rows values(r->>'barcode',vid,r,p_sha);
   insert into public.audit_log(action,entity_type,entity_id,metadata)
     values('m9.catalog.create','variant',vid,jsonb_build_object('source_sha256',p_sha,'barcode',r->>'barcode','operator',current_user));
   created:=created+1;
 end loop;
 return jsonb_build_object('created',created,'updated',changed,'unchanged',unchanged,'source_sha256',p_sha,'inventory_operations',0);
end;
$$;
revoke all on function app.m9_current_row(uuid),app.m9_catalog_plan(jsonb,text),app.m9_catalog_apply(jsonb,text,text) from public,anon,authenticated,service_role;
comment on function app.m9_catalog_apply(jsonb,text,text) is 'M9 staging pilot operator only: preview token required, no inventory operations. No public RPC.';
commit;
