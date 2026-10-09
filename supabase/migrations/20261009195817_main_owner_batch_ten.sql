-- Authorized 2026-10-09: up to ten owner questions per explicit batch.
-- Question inbox only; preserves evidence, operator, pending and replay guards.
begin;
create or replace function app.release_main_m9_question_batch(p_cut text,p_ids text[]) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare next_batch integer;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY'; end if;
 perform 1 from app.main_m9_review_cuts where cut_sha=p_cut and ready for update;
 if not found or p_ids is null or cardinality(p_ids) not between 1 and 10 or (select count(distinct id) from unnest(p_ids) id)<>cardinality(p_ids) then raise exception 'INVALID_QUESTION_BATCH'; end if;
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

commit;
