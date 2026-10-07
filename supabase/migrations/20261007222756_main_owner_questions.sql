begin;
-- Independent owner inbox. No staging catalog dependencies or operational writes.
create table app.main_m9_review_cuts (
 cut_sha text primary key check(cut_sha ~ '^[a-f0-9]{64}$'),
 ready boolean not null default false,
 created_at timestamptz not null default now()
);
alter table app.main_m9_review_cuts enable row level security;
revoke all on app.main_m9_review_cuts from public,anon,authenticated,service_role;
create table app.main_m9_owner_questions (
 cut_sha text not null references app.main_m9_review_cuts(cut_sha),
 question_id text not null check(question_id ~ '^[a-f0-9]{64}$'),
 evidence jsonb not null,
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{32}$'),
 batch integer check(batch>0),
 released_at timestamptz,
 primary key(cut_sha,question_id)
);
create table app.main_m9_owner_answers (
 request_id uuid primary key,
 cut_sha text not null,
 question_id text not null,
 revision integer not null check(revision>0),
 actor uuid not null references public.app_users(id),
 choice text not null check(choice in ('SAME_MODEL','CORRECTION','UNSURE')),
 note text not null check(length(note)<=2000),
 commercial_name text not null check(length(commercial_name)<=200),
 created_at timestamptz not null default now(),
 foreign key(cut_sha,question_id) references app.main_m9_owner_questions(cut_sha,question_id),
 unique(cut_sha,question_id,revision)
);
alter table app.main_m9_owner_questions enable row level security;
alter table app.main_m9_owner_answers enable row level security;
revoke all on app.main_m9_owner_questions,app.main_m9_owner_answers from public,anon,authenticated,service_role;

create function app.main_m9_question_current(p_cut text,p_evidence jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from app.main_m9_review_cuts c where c.cut_sha=p_cut and c.ready and c.cut_sha=(select cut_sha from app.main_m9_review_cuts where ready order by created_at desc,cut_sha limit 1))
 and (not exists(select 1 from app.main_m9_owner_questions q where q.cut_sha=p_cut and q.question_id=p_evidence->>'question_id') or exists(select 1 from app.main_m9_owner_questions q where q.cut_sha=p_cut and q.question_id=p_evidence->>'question_id' and q.evidence_hash=md5(p_evidence::text)))
$$;
revoke all on function app.main_m9_question_current(text,jsonb) from public,anon,authenticated,service_role;

create function app.load_main_m9_owner_questions(p_cut text,p_rows jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare r jsonb; old jsonb; n integer:=0; unchanged integer:=0;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY'; end if;
 perform 1 from app.main_m9_review_cuts where cut_sha=p_cut and ready for update;
 if not found then raise exception 'M9_COMPLETE_CUT_REQUIRED'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'INVALID_QUESTIONS'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r) is distinct from 'object' or
   (select array_agg(k order by k) from jsonb_object_keys(r) k) is distinct from array['department','help','members','previously_consulted','priority','question','question_id','section','source_case_sha','title']::text[]
   or coalesce(r->>'question_id','') !~ '^[a-f0-9]{64}$'
   or coalesce(r->>'source_case_sha','') !~ '^[a-f0-9]{64}$'
   or exists(select 1 from jsonb_each(r) e where e.key in ('title','question','help','department','section') and (jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}') not between 1 and 2000))
   or jsonb_typeof(r->'priority') is distinct from 'boolean' or jsonb_typeof(r->'previously_consulted') is distinct from 'boolean'
   or jsonb_typeof(r->'members') is distinct from 'array'
   then raise exception 'INVALID_QUESTION_FIELDS'; end if;
  if jsonb_array_length(r->'members') not between 1 and 40 or
    (select count(distinct m->>'barcode') from jsonb_array_elements(r->'members') m)<>jsonb_array_length(r->'members')
    or exists(select 1 from jsonb_array_elements(r->'members') m where
     jsonb_typeof(m) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(m) k) is distinct from array['barcode','size','source_evidence']::text[]
     or jsonb_typeof(m->'barcode') is distinct from 'string' or jsonb_typeof(m->'size') is distinct from 'string' or length(m->>'size') not between 1 and 80
     or m->'source_evidence'->>'description' is distinct from (r->>'title')||'T.'||(m->>'size')
     or m->'source_evidence'->>'department' is distinct from r->>'department'
     or m->'source_evidence'->>'section' is distinct from r->>'section')
    or not app.main_m9_question_current(p_cut,r) then raise exception 'M9_QUESTION_SOURCE_CHANGED'; end if;
  select evidence into old from app.main_m9_owner_questions where cut_sha=p_cut and question_id=r->>'question_id';
  if found then
   if old is distinct from r then raise exception 'M9_QUESTION_CHANGED'; end if;
   unchanged:=unchanged+1;
  else
   if exists(select 1 from app.main_m9_owner_questions q, jsonb_array_elements(q.evidence->'members') a, jsonb_array_elements(r->'members') b where q.cut_sha=p_cut and a->>'barcode'=b->>'barcode') then raise exception 'M9_QUESTION_OVERLAP'; end if;
   insert into app.main_m9_owner_questions(cut_sha,question_id,evidence,evidence_hash) values(p_cut,r->>'question_id',r,md5(r::text)); n:=n+1;
  end if;
 end loop;
 return jsonb_build_object('created',n,'unchanged',unchanged,'approved_for_import',0);
end $$;
revoke all on function app.load_main_m9_owner_questions(text,jsonb) from public,anon,authenticated,service_role;

-- Only the migration operator releases a small explicit set; never the whole bank.
create function app.release_main_m9_question_batch(p_cut text,p_ids text[]) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare next_batch integer;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY'; end if;
 perform 1 from app.main_m9_review_cuts where cut_sha=p_cut and ready for update;
 if not found or p_ids is null or cardinality(p_ids) not between 1 and 3 or (select count(distinct id) from unnest(p_ids) id)<>cardinality(p_ids) then raise exception 'INVALID_QUESTION_BATCH'; end if;
 if (select count(*) from app.main_m9_owner_questions where cut_sha=p_cut and question_id=any(p_ids))<>cardinality(p_ids) then raise exception 'UNKNOWN_QUESTION'; end if;
 if not exists(select 1 from app.main_m9_owner_questions where cut_sha=p_cut and question_id=any(p_ids) and batch is null) then
  if (select count(distinct batch) from app.main_m9_owner_questions where cut_sha=p_cut and question_id=any(p_ids))<>1 then raise exception 'M9_BATCH_CHANGED'; end if;
  return jsonb_build_object('released',0,'unchanged',cardinality(p_ids));
 end if;
 if exists(select 1 from app.main_m9_owner_questions where cut_sha=p_cut and question_id=any(p_ids) and (batch is not null or not app.main_m9_question_current(p_cut,evidence))) then raise exception 'M9_BATCH_CHANGED'; end if;
 if exists(select 1 from app.main_m9_owner_questions q left join lateral(select choice from app.main_m9_owner_answers a where a.cut_sha=q.cut_sha and a.question_id=q.question_id order by revision desc limit 1) a on true where q.cut_sha=p_cut and q.batch is not null and (a.choice is null or a.choice='UNSURE')) then raise exception 'M9_BATCH_STILL_OPEN'; end if;
 select coalesce(max(batch),0)+1 into next_batch from app.main_m9_owner_questions where cut_sha=p_cut;
 update app.main_m9_owner_questions set batch=next_batch,released_at=now() where cut_sha=p_cut and question_id=any(p_ids);
 return jsonb_build_object('released',cardinality(p_ids),'batch',next_batch,'approved_for_import',0);
end $$;
revoke all on function app.release_main_m9_question_batch(text,text[]) from public,anon,authenticated,service_role;

create function app.main_m9_owner_inbox(p_query text default '',p_department text default '',p_state text default 'pending',p_priority boolean default true,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cut text; result jsonb;
begin
 if auth.uid() is null or not app.has_perm('products.read') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_query is null or length(p_query)>160 or p_department is null or length(p_department)>100 or p_state is null or p_state not in ('all','pending','answered','unsure') or p_priority is null or p_page is null or p_page not between 1 and 10000 then raise exception 'INVALID_REVIEW_FILTER'; end if;
 select cut_sha into cut from app.main_m9_review_cuts where ready order by created_at desc,cut_sha limit 1;
 with items as materialized (
  select q.*, a.revision,a.choice,a.note,a.commercial_name,a.created_at, app.main_m9_question_current(cut,q.evidence) as current_evidence
  from app.main_m9_owner_questions q left join lateral (select * from app.main_m9_owner_answers a where a.cut_sha=q.cut_sha and a.question_id=q.question_id order by revision desc limit 1) a on true where q.cut_sha=cut and q.batch is not null
 ), filtered as materialized (
  select * from items where (not p_priority or (evidence->>'priority')::boolean)
   and (p_department='' or evidence->>'department'=p_department)
   and (p_query='' or strpos(lower(evidence::text),lower(p_query))>0)
   and (p_state='all' or (p_state='pending' and (revision is null or choice='UNSURE')) or (p_state='answered' and revision is not null and choice<>'UNSURE') or (p_state='unsure' and choice='UNSURE'))
 ), page as (select * from filtered order by (evidence->>'priority')::boolean desc,question_id limit 6 offset (p_page-1)*6)
 select jsonb_build_object('cut_sha',cut,'can_answer',app.has_perm('products.update'),'total',(select count(*) from filtered),'page',p_page,'page_size',6,
  'summary',(select jsonb_build_object('questions',count(*),'covered_rows',coalesce(sum(jsonb_array_length(evidence->'members')),0),'answered',count(*) filter(where revision is not null and choice<>'UNSURE'),'unsure',count(*) filter(where choice='UNSURE'),'priority_questions',count(*) filter(where (evidence->>'priority')::boolean),'batch',coalesce(max(batch),0)) from items),
  'departments',(select coalesce(jsonb_agg(d order by d),'[]'::jsonb) from (select distinct evidence->>'department' d from items) x),
  'rows',coalesce((select jsonb_agg(evidence || jsonb_build_object('batch',batch,'current_evidence',current_evidence,'revision',coalesce(revision,0),'answer',case when revision is null then null else jsonb_build_object('choice',choice,'note',note,'commercial_name',commercial_name,'created_at',created_at) end) order by (evidence->>'priority')::boolean desc,question_id) from page),'[]'::jsonb),
  'import_allowed',false,'send_allowed',false) into result;
 return result;
end $$;
revoke all on function app.main_m9_owner_inbox(text,text,text,boolean,integer) from public,anon,service_role;
grant execute on function app.main_m9_owner_inbox(text,text,text,boolean,integer) to authenticated;

create function app.main_m9_save_owner_answer(p_cut text,p_question text,p_revision integer,p_request uuid,p_choice text,p_note text,p_name text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare q app.main_m9_owner_questions%rowtype; prior app.main_m9_owner_answers%rowtype; rev integer;
begin
 if auth.uid() is null or not app.has_perm('products.read') or not app.has_perm('products.update') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 or p_request is null or p_choice is null or p_choice not in ('SAME_MODEL','CORRECTION','UNSURE') or p_note is null or length(p_note)>2000 or (p_choice='CORRECTION' and length(btrim(p_note))<5) or p_name is null or length(p_name)>200 then raise exception 'INVALID_OWNER_ANSWER'; end if;
 perform 1 from app.main_m9_review_cuts where cut_sha=p_cut for share;
 select * into q from app.main_m9_owner_questions where cut_sha=p_cut and question_id=p_question for update;
 if not found or q.batch is null then raise exception 'M9_QUESTION_REQUIRED'; end if;
 if not app.main_m9_question_current(p_cut,q.evidence) then raise exception 'M9_QUESTION_STALE'; end if;
 select * into prior from app.main_m9_owner_answers where request_id=p_request;
 if found then
  if prior.cut_sha is distinct from p_cut or prior.question_id is distinct from p_question or prior.actor is distinct from auth.uid() or prior.choice is distinct from p_choice or prior.note is distinct from btrim(p_note) or prior.commercial_name is distinct from btrim(p_name) or prior.revision<>p_revision+1 then raise exception 'M9_REQUEST_CHANGED'; end if;
  return jsonb_build_object('revision',prior.revision,'replayed',true,'approved_for_import',0);
 end if;
 select coalesce(max(revision),0) into rev from app.main_m9_owner_answers where cut_sha=p_cut and question_id=p_question;
 if rev<>p_revision then raise exception 'M9_ANSWER_CHANGED'; end if;
 insert into app.main_m9_owner_answers(request_id,cut_sha,question_id,revision,actor,choice,note,commercial_name) values(p_request,p_cut,p_question,rev+1,auth.uid(),p_choice,btrim(p_note),btrim(p_name));
 return jsonb_build_object('revision',rev+1,'replayed',false,'approved_for_import',0);
end $$;
revoke all on function app.main_m9_save_owner_answer(text,text,integer,uuid,text,text,text) from public,anon,service_role;
grant execute on function app.main_m9_save_owner_answer(text,text,integer,uuid,text,text,text) to authenticated;

create function public.main_m9_owner_inbox(p_query text default '',p_department text default '',p_state text default 'pending',p_priority boolean default true,p_page integer default 1) returns jsonb language sql stable security invoker set search_path='' as $$ select app.main_m9_owner_inbox(p_query,p_department,p_state,p_priority,p_page) $$;
create function public.main_m9_save_owner_answer(p_cut text,p_question text,p_revision integer,p_request uuid,p_choice text,p_note text,p_name text) returns jsonb language sql volatile security invoker set search_path='' as $$ select app.main_m9_save_owner_answer(p_cut,p_question,p_revision,p_request,p_choice,p_note,p_name) $$;
revoke all on function public.main_m9_owner_inbox(text,text,text,boolean,integer),public.main_m9_save_owner_answer(text,text,integer,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.main_m9_owner_inbox(text,text,text,boolean,integer),public.main_m9_save_owner_answer(text,text,integer,uuid,text,text,text) to authenticated;
commit;
