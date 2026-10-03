begin;
-- Internal staging evidence; no new public RPC, worker, Woo or inventory writes.
create table app.web_category_bindings (
 product_id uuid primary key references app.web_content_sources(product_id),
 woo_product_id bigint not null check (woo_product_id > 0),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_fingerprint text not null,
 evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 mappings jsonb not null,
 category_paths jsonb not null,
 verified_at timestamptz not null default now(),
 invalidated_at timestamptz,
 invalidation_reason text
);
alter table app.web_category_bindings enable row level security;
revoke all on app.web_category_bindings from public,anon,authenticated,service_role;

create function app.web_category_binding_state(pid uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('valid', b.invalidated_at is null
   and b.source_sha256=s.source_sha256 and b.source_fingerprint=md5(s.snapshot::text)
   and b.woo_product_id=(s.snapshot->>'woo_product_id')::bigint
   and exists(select 1 from app.m9_products m where m.product_id=pid and m.woo_id=b.woo_product_id)
   and b.category_paths=coalesce(d.content,s.suggested_content)->'categories',
 'woo_product_id',b.woo_product_id,'mappings',b.mappings,'evidence_sha256',b.evidence_sha256,
 'invalidated_at',b.invalidated_at,'invalidation_reason',b.invalidation_reason,'send_allowed',false)
 from app.web_category_bindings b join app.web_content_sources s using(product_id)
 left join app.web_product_drafts d using(product_id) where b.product_id=pid
$$;
revoke all on function app.web_category_binding_state(uuid) from public,anon,authenticated,service_role;

create function app.prepare_web_category_binding(pid uuid, source_hash text, evidence_hash text, mapping jsonb, expected_content jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.web_content_sources; b app.web_category_bindings; paths jsonb; item jsonb; after_content jsonb; woo bigint;
begin
 perform app.assert_sicar_staging_enabled();
 if source_hash is null or source_hash !~ '^[0-9a-f]{64}$' or evidence_hash is null or evidence_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_EVIDENCE_HASH'; end if;
 if mapping is null or jsonb_typeof(mapping)<>'array' then raise exception 'INVALID_CATEGORY_MAPPING'; end if;
 if jsonb_array_length(mapping) not between 1 and 20 then raise exception 'INVALID_CATEGORY_MAPPING'; end if;
 for item in select value from jsonb_array_elements(mapping) loop
  if jsonb_typeof(item)<>'object' then raise exception 'INVALID_CATEGORY_MAPPING'; end if;
  if (select count(*) from jsonb_object_keys(item))<>2 or not(item ?& array['id','path'])
   or jsonb_typeof(item->'id')<>'number' or (item->>'id') !~ '^[1-9][0-9]{0,14}$'
   or jsonb_typeof(item->'path')<>'string' or length(btrim(item->>'path')) not between 1 and 240
   then raise exception 'INVALID_CATEGORY_MAPPING'; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(mapping))<>jsonb_array_length(mapping)
  or (select count(distinct value->>'path') from jsonb_array_elements(mapping))<>jsonb_array_length(mapping)
  then raise exception 'DUPLICATE_CATEGORY_MAPPING'; end if;
 select jsonb_agg(value->'path' order by ord) into paths from jsonb_array_elements(mapping) with ordinality as x(value,ord);
 perform 1 from public.products where id=pid for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 select * into strict s from app.web_content_sources where product_id=pid for update;
 if s.source_sha256<>source_hash then raise exception 'WEB_SOURCE_CHANGED'; end if;
 woo:=(s.snapshot->>'woo_product_id')::bigint;
 if not exists(select 1 from app.m9_products m where m.product_id=pid and m.woo_id=woo) then raise exception 'WOO_LINK_CHANGED'; end if;
 select * into b from app.web_category_bindings where product_id=pid for update;
 if found then
  if b.evidence_sha256=evidence_hash and b.mappings=mapping and (app.web_category_binding_state(pid)->>'valid')::boolean then
   return jsonb_build_object('product_id',pid,'result','UNCHANGED');
  end if;
  raise exception 'CATEGORY_BINDING_REVIEW_REQUIRED';
 end if;
 if exists(select 1 from app.web_product_drafts d where d.product_id=pid) then raise exception 'HUMAN_DRAFT_REVIEW_REQUIRED'; end if;
 if s.suggested_content is distinct from expected_content then raise exception 'WEB_SUGGESTION_CHANGED'; end if;
 after_content:=jsonb_set(s.suggested_content,'{categories}',paths);
 perform app.validate_web_content(after_content);
 update app.web_content_sources set suggested_content=after_content where product_id=pid;
 insert into app.web_category_bindings(product_id,woo_product_id,source_sha256,source_fingerprint,evidence_sha256,mappings,category_paths)
 values(pid,woo,source_hash,md5(s.snapshot::text),evidence_hash,mapping,paths);
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.web_categories.prepare','product',pid,
  jsonb_build_object('evidence_sha256',evidence_hash,'before',s.suggested_content->'categories','after',paths,'mappings',mapping,'woo_written',false));
 return jsonb_build_object('product_id',pid,'result','PREPARED');
end $$;
revoke all on function app.prepare_web_category_binding(uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;

create function app.invalidate_web_category_binding() returns trigger
language plpgsql security invoker set search_path='' as $$
declare pid uuid; reason text; changed boolean:=false; old_binding app.web_category_bindings;
begin
 if tg_op='DELETE' then pid:=old.product_id; else pid:=new.product_id; end if;
 if tg_table_name='web_product_drafts' then
  if tg_op='DELETE' then changed:=true;
  elsif tg_op='INSERT' then
   select new.content->'categories' is distinct from s.suggested_content->'categories' into changed from app.web_content_sources s where s.product_id=pid;
  else changed:=old.product_id is distinct from new.product_id or old.content->'categories' is distinct from new.content->'categories'; end if;
  reason:='DRAFT_CATEGORIES_CHANGED';
 elsif tg_table_name='web_content_sources' then
  changed:=old.product_id is distinct from new.product_id or old.source_sha256 is distinct from new.source_sha256 or old.snapshot is distinct from new.snapshot or old.suggested_content->'categories' is distinct from new.suggested_content->'categories';
  reason:='SOURCE_CHANGED';
 elsif tg_table_name='m9_products' then
  if tg_op='DELETE' then changed:=true; else changed:=old.product_id is distinct from new.product_id or old.woo_id is distinct from new.woo_id; end if;
  reason:='WOO_LINK_CHANGED';
 end if;
 if changed then
  for old_binding in update app.web_category_bindings set invalidated_at=now(),invalidation_reason=reason
    where product_id in (pid,old.product_id) and invalidated_at is null returning * loop
   insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.web_categories.invalidate','product',old_binding.product_id,
    jsonb_build_object('reason',reason,'evidence_sha256',old_binding.evidence_sha256,'actor',auth.uid(),'woo_written',false));
  end loop;
 end if;
 return null;
end $$;
revoke all on function app.invalidate_web_category_binding() from public,anon,authenticated,service_role;
create trigger web_categories_draft_changed after insert or update or delete on app.web_product_drafts for each row execute function app.invalidate_web_category_binding();
create trigger web_categories_source_changed after update on app.web_content_sources for each row execute function app.invalidate_web_category_binding();
create trigger web_categories_link_changed after update or delete on app.m9_products for each row execute function app.invalidate_web_category_binding();
commit;
