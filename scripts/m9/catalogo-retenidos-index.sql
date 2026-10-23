-- Private forward draft. References only; never creates merchandise or stock.
create table app.m9_held_reference_indexes(
 request_id uuid primary key,source_sha256 text not null unique check(source_sha256~'^[a-f0-9]{64}$'),
 packet_sha256 text not null,packet jsonb not null,actor_user_id uuid not null references public.app_users(id),
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table app.m9_held_reference_retirements(
 request_id uuid primary key,index_request_id uuid not null unique references app.m9_held_reference_indexes(request_id),
 actor_user_id uuid not null references public.app_users(id),reason text not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table app.m9_held_reference_indexes enable row level security;
alter table app.m9_held_reference_retirements enable row level security;
revoke all on app.m9_held_reference_indexes,app.m9_held_reference_retirements from public,anon,authenticated,service_role;
create trigger m9_held_indexes_immutable before update or delete on app.m9_held_reference_indexes for each row execute function app.m9_legacy_event_immutable();
create trigger m9_held_retirements_immutable before update or delete on app.m9_held_reference_retirements for each row execute function app.m9_legacy_event_immutable();

create function app.m9_held_reference_actor()returns uuid language plpgsql stable security invoker set search_path='' as $$
declare a uuid:=auth.uid();begin
 perform app.assert_sicar_staging_enabled();
 if a is null or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=a and u.is_active and r.code='ADMIN')or not app.has_perm('products.read')then raise insufficient_privilege;end if;return a;
end $$;
revoke all on function app.m9_held_reference_actor()from public,anon,authenticated,service_role;

create function app.m9_archive_held_references(p jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid;rid uuid;h text;old app.m9_held_reference_indexes;rows jsonb;r jsonb;a app.m9_pending_review;counts jsonb;rec jsonb;reuse int:=0;delta int:=0;fresh int:=0;
begin
 if current_user<>'postgres'then raise insufficient_privilege;end if;actor:=app.m9_held_reference_actor();
 if not app.m9_detail_shape(p,array['protocol','project_id','request_id','source_sha256','source_date','source_count','managed_count_at_preparation','observed_at','rows_json','rows_sha256'])
  or p->>'protocol'is distinct from'm9-held-reference-index-1'or p->>'project_id'is distinct from'zsezjtswqeijboezvado'
  or p->>'source_sha256'is distinct from'b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93'
  or p->>'source_date'is distinct from'2026-10-22'or p->'source_count'is distinct from'16396'::jsonb
  or p->'managed_count_at_preparation'is distinct from'15961'::jsonb
  or jsonb_typeof(p->'rows_json')is distinct from'string'
  or p->>'rows_sha256'is distinct from'1ce31a728b102db3bfa6279f35104d22032cf32c4c7f6b336a607c17076e82b3'
  or encode(extensions.digest(p->>'rows_json','sha256'),'hex')is distinct from p->>'rows_sha256'
  or octet_length(p::text)>500000 then raise exception 'HELD_EXACT_INDEX_REQUIRED';end if;
 rid:=(p->>'request_id')::uuid;h:=encode(extensions.digest(p::text,'sha256'),'hex');rows:=(p->>'rows_json')::jsonb;
 if jsonb_typeof(rows)is distinct from'array'or jsonb_array_length(rows)<>435
  or(select count(distinct x->>'barcode')from jsonb_array_elements(rows)x)<>435 then raise exception 'HELD_435_UNIQUE_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 lock table app.m9_rows,public.barcodes,app.m9_review_cuts,app.m9_pending_review in share mode;
 lock table app.m9_held_reference_indexes,app.m9_held_reference_retirements in share row exclusive mode;
 select *into old from app.m9_held_reference_indexes where request_id=rid;
 if found then
  if old.packet_sha256<>h or old.actor_user_id<>actor or exists(select 1 from app.m9_held_reference_retirements where index_request_id=rid)then raise exception 'HELD_INDEX_REPLAY_CHANGED_OR_RETIRED';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 for r in select value from jsonb_array_elements(rows)loop
  if not app.m9_detail_shape(r,array['barcode','reasons','display_restricted','origin_cut_sha','origin_evidence_sha256','overlay'])
   or jsonb_typeof(r->'barcode')is distinct from'string'or length(r->>'barcode')not between 1 and 80 or r->>'barcode'<>btrim(r->>'barcode')
   or jsonb_typeof(r->'reasons')is distinct from'array'or jsonb_array_length(r->'reasons')not between 1 and 4
   or(select count(distinct x)from jsonb_array_elements_text(r->'reasons')x)<>jsonb_array_length(r->'reasons')
   or exists(select 1 from jsonb_array_elements_text(r->'reasons')x where x not in('DISPLAY_OR_SALES_RESTRICTION','TAXONOMY_REVIEW','PUBLIC_PRICE_INVALID','CATEGORY_CONFLICT'))
   or r->'display_restricted'is distinct from to_jsonb((r->'reasons')?'DISPLAY_OR_SALES_RESTRICTION')
   or jsonb_typeof(r->'overlay')is distinct from'object'
   or exists(select 1 from jsonb_each(r->'overlay')v where v.key not in('description','department','section','retail_source')or jsonb_typeof(v.value)<>'string'or length(v.value#>>'{}')>4000)
   then raise exception 'HELD_ROW_INVALID';end if;
  if exists(select 1 from app.m9_rows where barcode=r->>'barcode')or exists(select 1 from public.barcodes where code=r->>'barcode')then raise exception 'HELD_CODE_NOW_IN_CATALOG';end if;
  if r->'origin_cut_sha'='null'::jsonb then
   if r->'origin_evidence_sha256'is distinct from'null'::jsonb or not app.m9_detail_shape(r->'overlay',array['description','department','section','retail_source'])
    or r->>'barcode'<>'18329'then raise exception 'HELD_NEW_SOURCE_SCOPE_CHANGED';end if;fresh:=fresh+1;
  else
   select *into a from app.m9_pending_review where cut_sha=r->>'origin_cut_sha'and barcode=r->>'barcode';
   if not found or r->>'origin_cut_sha'is distinct from'6194431341d80e14902bf6018c4cffedd712aea0d3af3a2cd1c9c9deec965858'or a.evidence->>'barcode'is distinct from r->>'barcode'
    or encode(extensions.digest(a.evidence::text,'sha256'),'hex')is distinct from r->>'origin_evidence_sha256'
    or not exists(select 1 from app.m9_review_cuts c where c.cut_sha=a.cut_sha and c.ready)
    then raise exception 'HELD_ORIGINAL_ARCHIVE_CHANGED';end if;
   if r->'overlay'='{}'::jsonb then reuse:=reuse+1;
   else if r->>'barcode'<>'9184'or r->'overlay'is distinct from'{"retail_source":"1990"}'::jsonb or a.evidence->>'retail_source'<>'1790'
    then raise exception 'HELD_OVERLAY_SCOPE_CHANGED';end if;delta:=delta+1;end if;
  end if;
 end loop;
 select jsonb_object_agg(reason,n)into counts from(select reason,count(*)n from jsonb_array_elements(rows)rr cross join lateral jsonb_array_elements_text(rr->'reasons')reason group by reason)x;
 if counts is distinct from'{"DISPLAY_OR_SALES_RESTRICTION":316,"TAXONOMY_REVIEW":86,"PUBLIC_PRICE_INVALID":40,"CATEGORY_CONFLICT":3}'::jsonb
  or reuse<>433 or delta<>1 or fresh<>1 then raise exception 'HELD_PARTITION_CHANGED';end if;
 rec:=jsonb_build_object('request_id',rid,'reference_count',435,'reused',433,'overlays',1,'new_reference',1,'reason_counts',counts,'catalog_created',0,'variants_created',0,'stock_written',false,'woo_written',false,'operational_authorization',false,'replayed',false);
 insert into app.m9_held_reference_indexes(request_id,source_sha256,packet_sha256,packet,actor_user_id,receipt)values(rid,p->>'source_sha256',h,p,actor,rec);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)values(actor,'m9.held_references.archive','migration',rid::text,rec);
 return rec;
end $$;
revoke all on function app.m9_archive_held_references(jsonb)from public,anon,authenticated,service_role;

create function app.m9_retire_held_references(req uuid,idx uuid,why text)returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid;old app.m9_held_reference_retirements;rec jsonb;begin
 if current_user<>'postgres'then raise insufficient_privilege;end if;actor:=app.m9_held_reference_actor();
 if req is null or idx is null or length(coalesce(why,''))not between 10 and 500 then raise exception 'HELD_RETIRE_REASON_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 lock table app.m9_held_reference_indexes,app.m9_held_reference_retirements in share row exclusive mode;
 select *into old from app.m9_held_reference_retirements where request_id=req;
 if found then if old.index_request_id<>idx or old.actor_user_id<>actor or old.reason<>why then raise exception 'HELD_RETIRE_REPLAY_CONFLICT';end if;return old.receipt||'{"replayed":true}'::jsonb;end if;
 perform 1 from app.m9_held_reference_indexes where request_id=idx;if not found then raise exception 'HELD_INDEX_ABSENT';end if;
 if exists(select 1 from app.m9_held_reference_retirements where index_request_id=idx)then raise exception 'HELD_ALREADY_RETIRED';end if;
 rec:=jsonb_build_object('request_id',req,'index_request_id',idx,'retired',true,'raw_source_preserved',true,'catalog_modified',false,'replayed',false);
 insert into app.m9_held_reference_retirements(request_id,index_request_id,actor_user_id,reason,receipt)values(req,idx,actor,why,rec);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)values(actor,'m9.held_references.retire','migration',req::text,rec);
 return rec;
end $$;
revoke all on function app.m9_retire_held_references(uuid,uuid,text)from public,anon,authenticated,service_role;

create function app.m9_held_reference_read(p jsonb)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid;idx app.m9_held_reference_indexes;q text;exact boolean;reason text;page int;rows jsonb;result jsonb;begin
 actor:=app.m9_held_reference_actor();
 if not app.m9_detail_shape(p,array['q','exact','reason','page'])or jsonb_typeof(p->'q')is distinct from'string'or length(p->>'q')>160
  or jsonb_typeof(p->'exact')is distinct from'boolean'or coalesce(p->>'reason','')not in('ALL','DISPLAY_OR_SALES_RESTRICTION','TAXONOMY_REVIEW','PUBLIC_PRICE_INVALID','CATEGORY_CONFLICT')
  or jsonb_typeof(p->'page')is distinct from'number'or coalesce(p->>'page','')!~'^[1-9][0-9]{0,4}$'then raise exception 'HELD_FILTER_INVALID';end if;
 q:=p->>'q';exact:=(p->>'exact')::boolean;reason:=p->>'reason';page:=(p->>'page')::int;
 select *into idx from app.m9_held_reference_indexes i where not exists(select 1 from app.m9_held_reference_retirements x where x.index_request_id=i.request_id)order by created_at desc,request_id limit 1;
 if not found then return jsonb_build_object('protocol','m9-held-reference-read-1','ready',false,'write_allowed',false,'operational_authorization',false);end if;
 rows:=(idx.packet->>'rows_json')::jsonb;
 with materialized_rows as materialized(
  select r.value row,coalesce(jsonb_build_object('description',a.evidence->'description','department',a.evidence->'department','section',a.evidence->'section','retail_source',a.evidence->'retail_source'),'{}')||(r.value->'overlay')projection,
   (r.value->'origin_cut_sha'='null'::jsonb or encode(extensions.digest(a.evidence::text,'sha256'),'hex')=r.value->>'origin_evidence_sha256')origin_intact,
   exists(select 1 from app.m9_rows m where m.barcode=r.value->>'barcode')catalog_now_present
  from jsonb_array_elements(rows)r(value)left join app.m9_pending_review a on a.cut_sha=r.value->>'origin_cut_sha'and a.barcode=r.value->>'barcode'
 ), filtered as materialized(
  select *from materialized_rows where(reason='ALL'or(row->'reasons')?reason)and(case when exact then row->>'barcode'=q else q=''or strpos(lower((row->>'barcode')||' '||projection::text),lower(q))>0 end)
 ), paged as(select *from filtered order by row->>'barcode'limit 20 offset((page-1)*20))
 select jsonb_build_object('protocol','m9-held-reference-read-1','ready',true,'index_request_id',idx.request_id,'source_sha256',idx.source_sha256,'source_date',idx.packet->>'source_date','archived_at',idx.created_at,
 'total_references',jsonb_array_length(rows),'reason_counts',idx.receipt->'reason_counts','total',(select count(*)from filtered),'page',page,'page_size',20,
 'examples',(select jsonb_object_agg(k,examples)from(select k,(select coalesce(jsonb_agg(e order by code),'[]')from(select jsonb_build_object('barcode',row->'barcode','description',case when origin_intact then projection->'description'else null end,'retail_source',case when origin_intact then projection->'retail_source'else null end)e,row->>'barcode'code,case when k='PUBLIC_PRICE_INVALID'then row_number()over(partition by(projection->>'retail_source'~'^[0]+([.]0+)?$')order by row->>'barcode')else row_number()over(order by row->>'barcode')end rn from materialized_rows where(row->'reasons')?k)x where rn<=case when k='PUBLIC_PRICE_INVALID'then 1 else 2 end)examples from unnest(array['DISPLAY_OR_SALES_RESTRICTION','TAXONOMY_REVIEW','PUBLIC_PRICE_INVALID','CATEGORY_CONFLICT'])k)ex),
 'price_subgroups',jsonb_build_object('extra_decimals',(select count(*)from materialized_rows where(row->'reasons')?'PUBLIC_PRICE_INVALID'and projection->>'retail_source'~'^[0-9]+[.][0-9]{3,}$'),'zero',(select count(*)from materialized_rows where(row->'reasons')?'PUBLIC_PRICE_INVALID'and projection->>'retail_source'~'^[0]+([.]0+)?$')),
 'current_catalog_overlap',(select count(*)from materialized_rows where catalog_now_present),'origin_changed',(select count(*)from materialized_rows where not coalesce(origin_intact,false)),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('barcode',row->'barcode','reasons',row->'reasons','display_restricted',row->'display_restricted','origin_cut_sha',row->'origin_cut_sha',
 'origin_intact',coalesce(origin_intact,false),'projection',case when origin_intact then projection else null end,'catalog_now_present',catalog_now_present,'sell_allowed',false,'stock_allowed',false,'woo_allowed',false)order by row->>'barcode')from paged),'[]'),
 'operational_authorization',false,'write_allowed',false)into result;return result;
end $$;
revoke all on function app.m9_held_reference_read(jsonb)from public,anon,service_role;
grant execute on function app.m9_held_reference_read(jsonb)to authenticated;
create function public.m9_held_reference_read(p_input jsonb)returns jsonb language sql stable security invoker set search_path=''as $$select app.m9_held_reference_read(p_input)$$;
revoke all on function public.m9_held_reference_read(jsonb)from public,anon,service_role;
grant execute on function public.m9_held_reference_read(jsonb)to authenticated;
