begin;
select app.assert_sicar_staging_enabled();
create function app.m9_legacy_registry_read(p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor(); q text; page_no integer; pages integer; total bigint; result jsonb; stock jsonb;
begin
 if p_input is null or jsonb_typeof(p_input) is distinct from 'object'
  or octet_length(p_input::text)>1000
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in('q','page'))
  or (p_input?'q' and jsonb_typeof(p_input->'q') is distinct from 'string')
  or (p_input?'page' and (p_input->>'page' is null or p_input->>'page' !~ '^[1-9][0-9]{0,5}$'))
 then raise exception 'M9_REGISTRY_READ_INPUT_INVALID'; end if;
 q:=left(btrim(coalesce(p_input->>'q','')),100);
 page_no:=coalesce((p_input->>'page')::integer,1);
 select count(*) into total from app.m9_legacy_registry r
 join app.m9_customer_sources s using(customer_key)
 join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256
 where b.source_scope<>'SYNTHETIC_QA_NOT_SICAR'
 and (q='' or position(lower(q) in lower(s.payload->>'source_display_name'))>0
 or position(q in coalesce(s.payload->>'phone_candidate',''))>0
 or position(lower(q) in lower(s.source_ref))>0 or position(lower(q) in r.id::text)>0);
 pages:=greatest(1,ceil(total::numeric/20)::integer);page_no:=least(page_no,pages);
 select coalesce(jsonb_agg(x.row order by x.positive desc,x.name,x.id),'[]'::jsonb) into result
 from(select jsonb_build_object('id',r.id,'key',r.customer_key,
 'name',s.payload->>'source_display_name','phone',s.payload->>'phone_candidate',
 'source_ref',s.source_ref,'source_scope',b.source_scope,'source_at',b.source_at,
 'source_balance_cents',s.used_cents,
 'source_unchanged',r.source_hash=encode(extensions.digest(convert_to(s.payload::text,'UTF8'),'sha256'),'hex'))row,
 (s.used_cents>0)positive,s.payload->>'source_display_name' name,r.id
 from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key)
 join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256
 where b.source_scope<>'SYNTHETIC_QA_NOT_SICAR'
 and (q='' or position(lower(q) in lower(s.payload->>'source_display_name'))>0
 or position(q in coalesce(s.payload->>'phone_candidate',''))>0
 or position(lower(q) in lower(s.source_ref))>0 or position(lower(q) in r.id::text)>0)
 order by (s.used_cents>0)desc,s.payload->>'source_display_name',r.id
 limit 20 offset (page_no-1)*20)x;
 -- Reuse the existing pilot reader; its SAVE action is never exposed here.
 stock:=app.m9_legacy_pilot_api('LIST','{"q":""}'::jsonb)->'stock';
 return jsonb_build_object('protocol','m9-legacy-registry-page-1','read_only',true,
 'registered',(select count(*)from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key)join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256 where b.source_scope<>'SYNTHETIC_QA_NOT_SICAR'),
 'general_archived',(select count(*)from app.m9_legacy_registry r join app.m9_customer_batches b on b.plan_sha256=r.batch_sha256 where b.source_scope='GENERAL_ARCHIVED_INDEBTED_SUBSET'),
 'total',total,'page',page_no,'pages',pages,'customers',result,'stock',stock,
 'operational_import_allowed',false);
end $$;
revoke all on function app.m9_legacy_registry_read(jsonb)from public,anon,service_role;
grant execute on function app.m9_legacy_registry_read(jsonb)to authenticated;
create function public.m9_legacy_registry_read(p_input jsonb default '{}'::jsonb)returns jsonb
language sql security invoker set search_path=''as $$select app.m9_legacy_registry_read(p_input);$$;
revoke all on function public.m9_legacy_registry_read(jsonb)from public,anon,service_role;
grant execute on function public.m9_legacy_registry_read(jsonb)to authenticated;
commit;
