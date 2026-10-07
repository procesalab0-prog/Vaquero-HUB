-- Operator read-only export. No catalog mutations and no interpretation as approval.
select jsonb_build_object('version','m9-owner-answer-export-1','cut_sha',c.cut_sha,
 'questions',coalesce((select jsonb_agg(jsonb_build_object('question_id',q.question_id,'evidence',q.evidence,'batch',q.batch,
  'answers',coalesce((select jsonb_agg(jsonb_build_object('revision',a.revision,'actor',a.actor,'choice',a.choice,'note',a.note,'commercial_name',a.commercial_name,'created_at',a.created_at) order by a.revision) from app.m9_owner_answers a where a.cut_sha=q.cut_sha and a.question_id=q.question_id),'[]'::jsonb)) order by q.batch,q.question_id)
  from app.m9_owner_questions q where q.cut_sha=c.cut_sha and q.batch is not null),'[]'::jsonb),
 'approved_for_import',0,'send_allowed',false) as export
from app.m9_review_cuts c where c.ready order by c.created_at desc,c.cut_sha limit 1;
