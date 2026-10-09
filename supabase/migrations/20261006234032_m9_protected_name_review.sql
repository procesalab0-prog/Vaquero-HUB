begin;
-- Private technical review. Never publication/business approval.
create table app.m9_name_reviews (
 woo_id bigint primary key, rows jsonb not null, context_sha256 text not null,
 source_sha256 text not null, evidence_sha256 text not null,
 reviewed_at timestamptz not null default clock_timestamp()
);
alter table app.m9_name_reviews enable row level security;
revoke all on app.m9_name_reviews from public,anon,authenticated,service_role;

create function app.m9_name_context(p_name text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('product',to_jsonb(p),'managed',to_jsonb(m),
 'rows',(select jsonb_agg(jsonb_build_object('variant_id',r.variant_id,'current',app.m9_current_row(r.variant_id),'stored',r.source_row) order by r.barcode)
 from app.m9_rows r join public.variants v on v.id=r.variant_id where v.product_id=p.id)) order by p.id),'[]'::jsonb)
 from public.products p left join app.m9_products m on m.product_id=p.id
 where p.search_name=lower(translate(p_name,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))
$$;
create function app.m9_name_review_valid(r jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from app.m9_name_reviews n
 where exists(select 1 from app.sicar_sync_control where singleton and environment_label='STAGING' and catalog_writes_enabled)
 and n.woo_id=(r->>'woo_product_id')::bigint and n.rows @> jsonb_build_array(r)
 and n.reviewed_at<=statement_timestamp()+interval '5 minutes'
 and n.reviewed_at>=statement_timestamp()-interval '24 hours'
 and n.context_sha256=encode(extensions.digest(app.m9_name_context(r->>'product_name')::text,'sha256'),'hex'))
$$;
create function app.review_m9_names(cases jsonb, parents jsonb, source_sha text, evidence_sha text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c jsonb; r jsonb; p jsonb; peer jsonb; proof jsonb; context jsonb; old app.m9_name_reviews;
 base text; k text; rows_all jsonb; created integer:=0; unchanged integer:=0;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY'; end if;
 perform app.assert_sicar_staging_enabled();
 if source_sha is null or source_sha !~ '^[a-f0-9]{64}$' or evidence_sha is null or evidence_sha !~ '^[a-f0-9]{64}$'
 or jsonb_typeof(cases) is distinct from 'array' or jsonb_typeof(parents) is distinct from 'array'
 then raise exception 'M9_INVALID_NAME_EVIDENCE'; end if;
 if jsonb_array_length(cases) not between 1 and 100 or jsonb_array_length(parents) not between 1 and 10000
 then raise exception 'M9_INVALID_NAME_EVIDENCE'; end if;
 if exists(select 1 from jsonb_array_elements(parents) x where jsonb_typeof(x) is distinct from 'object'
 or coalesce(x->>'id','') !~ '^[1-9][0-9]{0,14}$' or jsonb_typeof(x->'name') is distinct from 'string'
 or jsonb_typeof(x->'base_original') is distinct from 'string')
 or (select count(distinct x->>'id') from jsonb_array_elements(parents) x)<>jsonb_array_length(parents)
 or (select count(distinct x->>'woo_id') from jsonb_array_elements(cases) x)<>jsonb_array_length(cases)
 then raise exception 'M9_INVALID_NAME_EVIDENCE'; end if;
 lock table public.products,public.variants,public.barcodes,public.categories,
 public.attribute_values,public.variant_attributes,public.m9_variant_details,
 app.m9_rows,app.m9_products,app.m9_name_reviews in share row exclusive mode;
 for c in select value from jsonb_array_elements(cases) loop
  if jsonb_typeof(c->'rows') is distinct from 'array' or jsonb_array_length(c->'rows') not between 1 and 1000
  or coalesce(c->>'woo_id','') !~ '^[1-9][0-9]{0,14}$' then raise exception 'M9_INVALID_NAME_CASE'; end if;
  select value into p from jsonb_array_elements(parents) where value->>'id'=c->>'woo_id';
  if p is null then raise exception 'M9_SOURCE_PARENT_ABSENT'; end if;
  if p->>'status' is distinct from 'publish' then raise exception 'M9_SOURCE_NOT_PUBLISHED'; end if;
  base:=upper(btrim(p->>'base_original'));
  if base !~ '^[[:alnum:]][[:alnum:]._/&-]{0,119}$' then raise exception 'M9_BASE_NOT_LITERAL'; end if;
  if (select count(*) from jsonb_array_elements(parents) x where upper(btrim(x->>'base_original'))=base)<>1
  then raise exception 'M9_BASE_REUSED'; end if;
  k:=lower(translate(btrim(p->>'name'),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'));
  for peer in select value from jsonb_array_elements(parents)
   where lower(translate(btrim(value->>'name'),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))=k loop
   if upper(btrim(peer->>'base_original')) !~ '^[[:alnum:]][[:alnum:]._/&-]{0,119}$'
   or (select count(*) from jsonb_array_elements(parents) x where upper(btrim(x->>'base_original'))=upper(btrim(peer->>'base_original')))<>1
   then raise exception 'M9_PEER_BASE_REQUIRES_REVIEW'; end if;
   if peer->>'id'<>p->>'id' and (starts_with(base,upper(btrim(peer->>'base_original'))) or starts_with(upper(btrim(peer->>'base_original')),base))
   then raise exception 'M9_OVERLAPPING_BASES'; end if;
  end loop;
  context:=app.m9_name_context(p->>'name');
  if jsonb_array_length(context)=0 or encode(extensions.digest(context::text,'sha256'),'hex') is distinct from c->>'context_sha256'
   then raise exception 'M9_NAME_DESTINATION_CHANGED'; end if;
  if exists(select 1 from jsonb_array_elements(context) x where x->'managed'='null'::jsonb
   or not exists(select 1 from jsonb_array_elements(parents) y where y->>'id'=x->'managed'->>'woo_id'
    and y->>'name'=x->'product'->>'name' and lower(translate(btrim(y->>'name'),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))=k))
   then raise exception 'M9_UNMANAGED_OR_DIVERGED_PEER'; end if;
  if exists(select 1 from app.m9_products where woo_id=(c->>'woo_id')::bigint)
   then raise exception 'M9_PARENT_ALREADY_MANAGED'; end if;
  for r in select value from jsonb_array_elements(c->'rows') loop
   if r->>'woo_product_id' is distinct from c->>'woo_id' or r->>'product_name' is distinct from p->>'name'
    then raise exception 'M9_ROW_SOURCE_IDENTITY_CHANGED'; end if;
  end loop;
  select * into old from app.m9_name_reviews where woo_id=(c->>'woo_id')::bigint;
  if found then
   if old.rows=c->'rows' and old.context_sha256=c->>'context_sha256' and old.source_sha256=source_sha and old.evidence_sha256=evidence_sha
    and old.reviewed_at>=statement_timestamp()-interval '24 hours' then unchanged:=unchanged+1;continue; end if;
   raise exception 'M9_EXISTING_NAME_REVIEW_CHANGED';
  end if;
  proof:=app.m9_catalog_plan(c->'rows',evidence_sha);
  if jsonb_array_length(proof->'errors')<>jsonb_array_length(c->'rows')
   or exists(select 1 from jsonb_array_elements(proof->'errors') x where x->>'reason'<>'EXISTING_NAME_REQUIRES_IDENTITY_REVIEW')
   then raise exception 'M9_OTHER_CATALOG_CONTROLS_PENDING'; end if;
  insert into app.m9_name_reviews(woo_id,rows,context_sha256,source_sha256,evidence_sha256)
  values((c->>'woo_id')::bigint,c->'rows',c->>'context_sha256',source_sha,evidence_sha);
  created:=created+1;
 end loop;
 select jsonb_agg(row_item.value) into rows_all from jsonb_array_elements(cases) case_item cross join lateral jsonb_array_elements(case_item.value->'rows') row_item;
 proof:=app.m9_catalog_plan(rows_all,evidence_sha);
 if not (proof->>'write_allowed')::boolean then raise exception 'M9_OTHER_CATALOG_CONTROLS_PENDING' using detail=(proof->'errors')::text; end if;
 return jsonb_build_object('reviewed',created,'unchanged',unchanged,'publication_allowed',false,'inventory_operations',0);
end $$;
revoke all on function app.m9_name_context(text),app.m9_name_review_valid(jsonb),app.review_m9_names(jsonb,jsonb,text,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app.m9_catalog_plan(p_rows jsonb, p_sha text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
     then if not app.m9_name_review_valid(r) then reason := 'EXISTING_NAME_REQUIRES_IDENTITY_REVIEW'; end if; end if;
     if parent.product_id is not null and exists(select 1 from app.m9_rows s join public.variants v on v.id=s.variant_id
       where v.product_id=parent.product_id and s.source_row->'attributes'=r->'attributes')
     then reason := 'EXISTING_ATTRIBUTE_COMBINATION'; end if;
   end if;
   if reason is not null then errors:=errors||jsonb_build_array(jsonb_build_object('barcode',r->>'barcode','reason',reason)); end if;
   actions:=actions||jsonb_build_array(jsonb_build_object('barcode',r->>'barcode','action',action));
 end loop;
 -- Includes relevant live state; an accepted preview becomes stale after any catalog change.
 token := encode(extensions.digest((jsonb_build_object('rows',p_rows,'source',p_sha,
   'name_reviews',(select jsonb_agg(to_jsonb(n) order by n.woo_id) from app.m9_name_reviews n),
   'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.variants v),
   'products',(select jsonb_agg(to_jsonb(p) order by p.id) from public.products p),
   'barcodes',(select jsonb_agg(to_jsonb(b) order by b.id) from public.barcodes b),
   'categories',(select jsonb_agg(to_jsonb(c) order by c.id) from public.categories c),
   'attrs',(select jsonb_agg(to_jsonb(av_row) order by av_row.id) from public.attribute_values av_row),
   'links',(select jsonb_agg(to_jsonb(va_row) order by va_row.variant_id,va_row.type_code) from public.variant_attributes va_row),
   'details',(select jsonb_agg(to_jsonb(d) order by d.variant_id) from public.m9_variant_details d),
   'managed',(select jsonb_agg(to_jsonb(s) order by s.barcode) from app.m9_rows s)
 ))::text,'sha256'),'hex');
 return jsonb_build_object('version','m9-import-1','source_sha256',p_sha,'token',token,'errors',errors,'actions',actions,'write_allowed',jsonb_array_length(errors)=0);
end;
$function$;

CREATE OR REPLACE FUNCTION app.m9_catalog_apply(p_rows jsonb, p_sha text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 plan jsonb; r jsonb; a record; oldrow app.m9_rows%rowtype;
 pid uuid; vid uuid; cid uuid; aid uuid; serial bigint; scale text;
 created integer:=0; changed integer:=0; unchanged integer:=0;
begin
 if current_user <> 'postgres' then raise exception 'M9_OPERATOR_ONLY'; end if;
 if to_regprocedure('app.assert_sicar_staging_enabled()') is null then raise exception 'M9_STAGING_CONTROL_REQUIRED'; end if;
 perform app.assert_sicar_staging_enabled();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sicar-catalog-sync',0));
 -- Coordinate ordinary catalog writes too, not just this importer. Pilot-size only.
 lock table public.products,public.variants,public.barcodes,public.categories,
   public.attribute_values,public.variant_attributes,public.m9_variant_details,
   app.m9_rows,app.m9_products,app.m9_name_reviews in share row exclusive mode;
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
   scale:='M9_'||upper(md5(r->>'section'));
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
$function$;

revoke all on function app.m9_catalog_plan(jsonb,text),app.m9_catalog_apply(jsonb,text,text) from public,anon,authenticated,service_role;
commit;
