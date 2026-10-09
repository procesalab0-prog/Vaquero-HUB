begin;
-- Evidence intake only. These records never create variants, approvals or stock.
create table app.m9_review_cuts (
 cut_sha text primary key check(cut_sha ~ '^[a-f0-9]{64}$'),
 sicar_sha text not null check(sicar_sha ~ '^[a-f0-9]{64}$'),
 woo_sha text not null check(woo_sha ~ '^[a-f0-9]{64}$'),
 source_count integer not null check(source_count>0),
 managed_count integer not null check(managed_count>=0),
 expected_count integer not null check(expected_count>0),
 ready boolean not null default false,
 created_at timestamptz not null default now(),
 check(source_count=managed_count+expected_count)
);
create table app.m9_pending_review (
 cut_sha text not null references app.m9_review_cuts(cut_sha),
 barcode text not null check(length(barcode) between 1 and 200),
 evidence jsonb not null,
 primary key(cut_sha,barcode)
);
alter table app.m9_review_cuts enable row level security;
alter table app.m9_pending_review enable row level security;
revoke all on app.m9_review_cuts,app.m9_pending_review from public,anon,authenticated,service_role;

create function app.load_m9_pending_review(p_cut text,p_rows jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare c app.m9_review_cuts%rowtype; r jsonb; old jsonb; n integer:=0; unchanged integer:=0;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY'; end if;
 perform app.assert_sicar_staging_enabled();
 select * into c from app.m9_review_cuts where cut_sha=p_cut for update;
 if not found then raise exception 'M9_CUT_REQUIRED'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'M9_INVALID_ROWS'; end if;
 if jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'M9_BATCH_LIMIT'; end if;
 if (select count(*) from app.m9_rows)<>c.managed_count then raise exception 'M9_CATALOG_CHANGED'; end if;
 if (select count(distinct value->>'barcode') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'M9_DUPLICATE_CODE'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'M9_INVALID_ROW'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(r) k) is distinct from array['barcode','candidate_woo_ids','classification','department','description','price_cents','reasons','retail_source','section']::text[] then raise exception 'M9_UNKNOWN_FIELDS'; end if;
  if exists(select 1 from jsonb_each(r) e where e.key in ('barcode','description','department','section','retail_source','classification') and (jsonb_typeof(e.value)<>'string' or length(e.value #>> '{}')>4000))
    or length(r->>'barcode') not between 1 and 200
    or jsonb_typeof(r->'candidate_woo_ids') is distinct from 'array'
    or jsonb_typeof(r->'reasons') is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(r->'candidate_woo_ids') x where jsonb_typeof(x)<>'number' or x::text !~ '^[1-9][0-9]{0,14}$')
    or exists(select 1 from jsonb_array_elements(r->'reasons') x where jsonb_typeof(x)<>'string' or length(x #>> '{}')>2000)
    or (r->'price_cents'<>'null'::jsonb and (coalesce(r->>'price_cents','') !~ '^[0-9]{1,9}$' or (r->>'price_cents')::bigint<=0 or (r->>'price_cents')::bigint>100000000))
    then raise exception 'M9_INVALID_ROW'; end if;
  if exists(select 1 from app.m9_rows where barcode=r->>'barcode') then raise exception 'M9_ALREADY_MANAGED'; end if;
  select evidence into old from app.m9_pending_review where cut_sha=p_cut and barcode=r->>'barcode';
  if found then
   if old is distinct from r then raise exception 'M9_EVIDENCE_CHANGED'; end if;
   unchanged:=unchanged+1;
  else
   if c.ready then raise exception 'M9_SEALED_CUT'; end if;
   insert into app.m9_pending_review values(p_cut,r->>'barcode',r); n:=n+1;
  end if;
 end loop;
 if (select count(*) from app.m9_pending_review where cut_sha=p_cut)>c.expected_count then raise exception 'M9_CUT_OVERFLOW'; end if;
 return jsonb_build_object('created',n,'unchanged',unchanged,'catalog_created',0,'approval_created',0);
end $$;
revoke all on function app.load_m9_pending_review(text,jsonb) from public,anon,authenticated,service_role;

create function app.m9_pending_catalog(p_query text default '',p_exact boolean default false,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c app.m9_review_cuts%rowtype; result jsonb;
begin
 if auth.uid() is null or not app.has_perm('products.read') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 perform app.assert_sicar_staging_enabled();
 if p_query is null or length(p_query)>160 or p_exact is null or p_page is null or p_page not between 1 and 100000 then raise exception 'INVALID_REVIEW_FILTER'; end if;
 select * into c from app.m9_review_cuts where ready order by created_at desc,cut_sha limit 1;
 if not found then raise exception 'M9_COMPLETE_CUT_REQUIRED'; end if;
 with pending as materialized (
  select r.barcode,r.evidence from app.m9_pending_review r where r.cut_sha=c.cut_sha and not exists(select 1 from app.m9_rows m where m.barcode=r.barcode)
 ), filtered as materialized (
  select * from pending where case when p_exact then barcode=p_query else p_query='' or strpos(lower(evidence::text),lower(p_query))>0 end
 ), page as (select * from filtered order by barcode limit 20 offset ((p_page-1)*20))
 select jsonb_build_object('cut_sha',c.cut_sha,'sicar_sha',c.sicar_sha,'woo_sha',c.woo_sha,'source_count',c.source_count,
  'managed_count',(select count(*) from app.m9_rows),'pending_count',(select count(*) from pending),'total',(select count(*) from filtered),'page',p_page,'page_size',20,
  'status','PENDING_MANUAL_REVIEW','import_allowed',false,'send_allowed',false,
  'rows',coalesce((select jsonb_agg(evidence order by barcode) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function app.m9_pending_catalog(text,boolean,integer) from public,anon,service_role;
grant execute on function app.m9_pending_catalog(text,boolean,integer) to authenticated;
create function public.m9_pending_catalog(p_query text default '',p_exact boolean default false,p_page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$ select app.m9_pending_catalog(p_query,p_exact,p_page) $$;
revoke all on function public.m9_pending_catalog(text,boolean,integer) from public,anon,service_role;
grant execute on function public.m9_pending_catalog(text,boolean,integer) to authenticated;
commit;
