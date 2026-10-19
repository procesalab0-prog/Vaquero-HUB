begin;
-- Maintenance operations only, gated to staging. No public RPC or client grants.
create table app.m9_provisional_variants (
 variant_id uuid primary key references public.variants(id),
 original_product_id uuid not null references public.products(id),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_evidence jsonb not null,
 grouping_status text not null default 'PROVISIONAL' check(grouping_status in ('PROVISIONAL','GROUPED')),
 web_release boolean not null default false,
 grouping_event_id uuid,
 created_at timestamptz not null default now()
);
create index m9_provisional_original_parent on app.m9_provisional_variants(original_product_id);
create table app.m9_grouping_events (
 id uuid primary key,
 request_hash text not null,
 reviewer text not null,
 reason text not null,
 evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 before_state jsonb not null,
 after_state jsonb not null,
 receipt jsonb not null,
 reversed_at timestamptz,
 created_at timestamptz not null default now()
);
alter table app.m9_provisional_variants add constraint m9_provisional_event_fk foreign key(grouping_event_id) references app.m9_grouping_events(id) deferrable initially deferred;
create index m9_provisional_event on app.m9_provisional_variants(grouping_event_id);
alter table app.m9_provisional_variants enable row level security;
alter table app.m9_grouping_events enable row level security;
revoke all on app.m9_provisional_variants,app.m9_grouping_events from public,anon,authenticated,service_role;

create function app.m9_provisional_state(vid uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('variant_id',v.id,'product_id',v.product_id,'product',to_jsonb(p),
 'variant',to_jsonb(v),'stored',r.source_row,'current',app.m9_sicar_current_row(v.id),
 'registry',to_jsonb(pv),'attributes',coalesce((select jsonb_agg(to_jsonb(a) order by a.type_code) from public.variant_attributes a where a.variant_id=v.id),'[]'::jsonb))
 from app.m9_provisional_variants pv join public.variants v on v.id=pv.variant_id
 join public.products p on p.id=v.product_id join app.m9_rows r on r.variant_id=v.id where v.id=vid;
$$;

create function app.m9_register_provisionals(p_rows jsonb,p_sources jsonb,p_sha text) returns integer
language plpgsql security invoker set search_path='' as $$
declare r jsonb;s jsonb;v uuid;pid uuid;old app.m9_provisional_variants;n integer:=0;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY';end if;
 perform app.assert_sicar_staging_enabled();
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 if p_sha !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_sources) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 1000 or jsonb_array_length(p_rows)<>jsonb_array_length(p_sources) then raise exception 'M9_INVALID_PROVISIONAL_INPUT';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  select x into strict s from jsonb_array_elements(p_sources) x where x->>'barcode'=r->>'barcode';
  select mr.variant_id,vv.product_id into strict v,pid from app.m9_rows mr join public.variants vv on vv.id=mr.variant_id where mr.barcode=r->>'barcode' and mr.source_sha256=p_sha and mr.source_row=r;
  if app.m9_sicar_current_row(v) is distinct from r or r->>'family_key' not like 'prov-%' or r->'attributes'<>'{}'::jsonb
   or r->'cost_cents' is distinct from 'null'::jsonb or (select count(*) from public.variants where product_id=pid)<>1
   or exists(select 1 from public.variants where id=v and (woocommerce_product_id is not null or woocommerce_variation_id is not null))
   or s#>>'{fields,clave1 *}' is distinct from r->>'barcode' or s#>>'{fields,descripción *}' is distinct from r->>'description'
   or s#>>'{fields,departamento}' is distinct from r->>'department' or s#>>'{fields,categoria}' is distinct from r->>'section'
   or s#>>'{fields,unidad}' is distinct from 'PIEZA' or s#>>'{fields,(s/n) inventariable}' is distinct from 's'
   or s#>>'{fields,(s/n) mostrar en ventas}' is distinct from 's' or s->>'grouping_status' is distinct from 'PROVISIONAL'
   or s->'web_release' is distinct from 'false'::jsonb
   then raise exception 'M9_PROVISIONAL_EVIDENCE_CHANGED';end if;
  if s#>>'{fields,precio1}' !~ '^[0-9]+([.][0-9]{1,2})?$' or (s#>>'{fields,precio1}')::numeric*100<>(r->>'price_cents')::bigint then raise exception 'M9_PROVISIONAL_PRICE_CHANGED';end if;
  select * into old from app.m9_provisional_variants where variant_id=v;
  if found then
   if old.source_sha256<>p_sha or old.source_evidence<>s then raise exception 'M9_PROVISIONAL_ALREADY_REGISTERED';end if;
  else
   insert into app.m9_provisional_variants(variant_id,original_product_id,source_sha256,source_evidence) values(v,pid,p_sha,s);
   insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.provisional.register','variant',v::text,jsonb_build_object('source_sha256',p_sha,'barcode',r->>'barcode','operator',current_user));n:=n+1;
  end if;
 end loop;
 return n;
end $$;

-- The web remains blocked even after grouping, until a separate web review.
create function app.guard_m9_provisional_web() returns trigger
language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
 if tg_table_name='variants' then
  if new.woocommerce_product_id is not distinct from old.woocommerce_product_id and new.woocommerce_variation_id is not distinct from old.woocommerce_variation_id then return new;end if;
  if exists(select 1 from app.m9_provisional_variants p where p.variant_id=new.id and not p.web_release) then raise exception 'M9_PROVISIONAL_WEB_BLOCKED';end if;
 else
  pid:=new.product_id;
  if exists(select 1 from app.m9_provisional_variants p join public.variants v on v.id=p.variant_id where v.product_id=pid and not p.web_release) then raise exception 'M9_PROVISIONAL_WEB_BLOCKED';end if;
 end if;
 return new;
end $$;
create trigger variants_provisional_web before update of woocommerce_product_id,woocommerce_variation_id on public.variants for each row execute function app.guard_m9_provisional_web();
create trigger web_lab_provisional_guard before insert or update on app.web_lab_jobs for each row execute function app.guard_m9_provisional_web();
create trigger web_remote_provisional_guard before insert or update on app.web_remote_jobs for each row execute function app.guard_m9_provisional_web();

create function app.m9_provisional_group_plan(p_name text,p_members jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare m jsonb;st jsonb;states jsonb:='[]';seen uuid[]:='{}';vid uuid;signature text;signatures text[]:='{}';section text;department text;unit text;expected_section text;expected_department text;expected_unit text;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY';end if;
 perform app.assert_sicar_staging_enabled();
 if p_name is null or length(p_name) not between 1 and 160 or p_name<>btrim(p_name) or jsonb_typeof(p_members) is distinct from 'array' or jsonb_array_length(p_members) not between 2 and 100 then raise exception 'M9_GROUP_INPUT_INVALID';end if;
 if exists(select 1 from public.products where search_name=lower(translate(p_name,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))) then raise exception 'M9_GROUP_NAME_EXISTS';end if;
 for m in select value from jsonb_array_elements(p_members) order by value->>'variant_id' loop
  vid:=(m->>'variant_id')::uuid;
  if vid is null or vid=any(seen) or jsonb_typeof(m->'attributes') is distinct from 'object' then raise exception 'M9_GROUP_MEMBER_INVALID';end if;
  if exists(select 1 from jsonb_each(m->'attributes') a where a.key not in ('TALLA','COLOR','LARGO') or jsonb_typeof(a.value)<>'string' or length(a.value#>>'{}') not between 1 and 80 or a.value#>>'{}'<>btrim(a.value#>>'{}')) then raise exception 'M9_GROUP_ATTRIBUTE_INVALID';end if;
  signature:=(m->'attributes')::text;
  if signature=any(signatures) then raise exception 'M9_GROUP_DUPLICATE_ATTRIBUTES';end if;
  signatures:=array_append(signatures,signature);seen:=array_append(seen,vid);
  st:=app.m9_provisional_state(vid);
  if st is null or st#>>'{registry,grouping_status}'<>'PROVISIONAL' or st->'current' is distinct from st->'stored'
   or st#>>'{variant,woocommerce_product_id}' is not null or st#>>'{variant,woocommerce_variation_id}' is not null
   or (select count(*) from public.variants where product_id=(st->>'product_id')::uuid)<>1 then raise exception 'M9_GROUP_MEMBER_CHANGED';end if;
  section:=st#>>'{current,section}';department:=st#>>'{current,department}';unit:=st#>>'{product,measure_unit_code}';
  if expected_section is not null and (section<>expected_section or department<>expected_department or unit<>expected_unit) then raise exception 'M9_GROUP_CLASS_OR_UNIT_DIFFERS';end if;
  expected_section:=section;expected_department:=department;expected_unit:=unit;
  states:=states||jsonb_build_array(st);
 end loop;
 return jsonb_build_object('token',encode(extensions.digest(jsonb_build_object('name',p_name,'members',p_members,'states',states)::text,'sha256'),'hex'),'states',states,'members',p_members,'product_name',p_name,'write_allowed',true);
end $$;

create function app.m9_group_provisionals(p_request uuid,p_name text,p_members jsonb,p_token text,p_reviewer text,p_reason text,p_evidence_sha text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare plan jsonb;old app.m9_grouping_events;reqhash text;pid uuid;family text;st jsonb;m jsonb;a record;aid uuid;scale text;vid uuid;after_rows jsonb:='[]';receipt jsonb;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY';end if;
 perform app.assert_sicar_staging_enabled();
 if p_request is null or coalesce(length(btrim(p_reviewer)),0) not between 1 and 160 or coalesce(length(btrim(p_reason)),0) not between 5 and 2000 or p_evidence_sha is null or p_evidence_sha !~ '^[a-f0-9]{64}$' then raise exception 'M9_GROUP_REVIEW_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 lock table public.products,public.variants,public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,app.m9_rows,app.m9_sicar_products,app.m9_sicar_approved_rows,app.m9_provisional_variants,app.m9_grouping_events in share row exclusive mode;
 reqhash:=encode(extensions.digest(jsonb_build_object('name',p_name,'members',p_members,'reviewer',p_reviewer,'reason',p_reason,'evidence',p_evidence_sha)::text,'sha256'),'hex');
 select * into old from app.m9_grouping_events where id=p_request;
 if found then
  if old.request_hash<>reqhash or old.reversed_at is not null then raise exception 'M9_GROUP_REQUEST_REUSED';end if;
  return old.receipt;
 end if;
 set constraints all deferred;
 plan:=app.m9_provisional_group_plan(p_name,p_members);
 if p_token is distinct from plan->>'token' then raise exception 'M9_GROUP_STALE_PLAN';end if;
 st:=plan#>'{states,0}';
 insert into public.products(name,category_id,measure_unit_code) values(p_name,(st#>>'{product,category_id}')::uuid,st#>>'{product,measure_unit_code}') returning id into pid;
 family:='grouped-'||replace(p_request::text,'-','');
 insert into app.m9_sicar_products values(family,pid,st#>>'{current,section}',p_name);
 for m in select value from jsonb_array_elements(p_members) order by value->>'variant_id' loop
  vid:=(m->>'variant_id')::uuid;
  delete from public.variant_attributes where variant_id=vid;
  scale:='M9_'||upper(md5(st#>>'{current,section}'));
  if m->'attributes'<>'{}'::jsonb then insert into public.size_scales(code,name) values(scale,'SICAR literal: '||(st#>>'{current,section}')) on conflict(code) do nothing;end if;
  for a in select key,value from jsonb_each_text(m->'attributes') order by key loop
   insert into public.attribute_types(code,name) values(a.key,case a.key when 'TALLA' then 'Talla' when 'COLOR' then 'Color' when 'LARGO' then 'Largo' end) on conflict(code) do nothing;
   select id into aid from public.attribute_values where type_code=a.key and scale_code=scale and value=a.value;
   if aid is null then insert into public.attribute_values(type_code,scale_code,value,display_order) values(a.key,scale,a.value,0) returning id into aid;end if;
   insert into public.variant_attributes(variant_id,type_code,value_id) values(vid,a.key,aid);
  end loop;
  update public.variants set product_id=pid where id=vid;
  update app.m9_rows set source_row=app.m9_sicar_current_row(vid) where variant_id=vid;
  update app.m9_provisional_variants set grouping_status='GROUPED',grouping_event_id=p_request where variant_id=vid;
  after_rows:=after_rows||jsonb_build_array(app.m9_provisional_state(vid));
 end loop;
 receipt:=jsonb_build_object('event_id',p_request,'product_id',pid,'variants',jsonb_array_length(p_members),'variant_ids_preserved',true,'inventory_operations',0);
 -- Insert event before forcing the deferred FK to be checked.
 insert into app.m9_grouping_events(id,request_hash,reviewer,reason,evidence_sha256,before_state,after_state,receipt) values(p_request,reqhash,p_reviewer,p_reason,p_evidence_sha,plan->'states',after_rows,receipt);
 set constraints all immediate;
 insert into public.audit_log(action,entity_type,entity_id,before_data,after_data,metadata) values('m9.provisional.group','grouping',p_request::text,plan->'states',after_rows,jsonb_build_object('reviewer',p_reviewer,'reason',p_reason,'evidence_sha256',p_evidence_sha,'operator',current_user));
 return receipt;
end $$;

create function app.m9_undo_provisional_group(p_event uuid,p_reviewer text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e app.m9_grouping_events;st jsonb;vid uuid;pid uuid;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY';end if;
 perform app.assert_sicar_staging_enabled();
 if coalesce(length(btrim(p_reviewer)),0) not between 1 and 160 or coalesce(length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'M9_GROUP_REVIEW_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 lock table public.products,public.variants,public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,app.m9_rows,app.m9_sicar_products,app.m9_sicar_approved_rows,app.m9_provisional_variants,app.m9_grouping_events in share row exclusive mode;
 select * into strict e from app.m9_grouping_events where id=p_event for update;
 if e.reversed_at is not null then return jsonb_build_object('event_id',p_event,'already_reversed',true);end if;
 for st in select value from jsonb_array_elements(e.after_state) loop
  if app.m9_provisional_state((st->>'variant_id')::uuid) is distinct from st then raise exception 'M9_UNDO_CURRENT_STATE_CHANGED';end if;
 end loop;
 for st in select value from jsonb_array_elements(e.before_state) loop
  vid:=(st->>'variant_id')::uuid;pid:=(st->>'product_id')::uuid;
  if (select to_jsonb(p) from public.products p where id=pid) is distinct from st->'product' then raise exception 'M9_UNDO_ORIGINAL_PARENT_CHANGED';end if;
  delete from public.variant_attributes where variant_id=vid;
  insert into public.variant_attributes select * from jsonb_populate_recordset(null::public.variant_attributes,st->'attributes');
  update public.variants set product_id=pid where id=vid;
  update app.m9_rows set source_row=st->'stored' where variant_id=vid;
  update app.m9_provisional_variants set grouping_status='PROVISIONAL',grouping_event_id=null where variant_id=vid;
 end loop;
 set constraints all immediate;
 update app.m9_grouping_events set reversed_at=clock_timestamp() where id=p_event;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.provisional.ungroup','grouping',p_event::text,jsonb_build_object('reviewer',p_reviewer,'reason',p_reason,'operator',current_user));
 return jsonb_build_object('event_id',p_event,'reversed',true,'variant_ids_preserved',true,'inventory_operations',0);
end $$;

revoke all on function app.m9_provisional_state(uuid),app.m9_register_provisionals(jsonb,jsonb,text),app.guard_m9_provisional_web(),app.m9_provisional_group_plan(text,jsonb),app.m9_group_provisionals(uuid,text,jsonb,text,text,text,text),app.m9_undo_provisional_group(uuid,text,text) from public,anon,authenticated,service_role;
commit;
