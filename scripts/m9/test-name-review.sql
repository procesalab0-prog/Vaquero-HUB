-- Run after candidate migration and pg_temp.name_input, inside BEGIN/ROLLBACK.
create function pg_temp.fail_if(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST_FAILED:%',label;end if;end$$;
create function pg_temp.must_fail(query text,message text) returns void language plpgsql as $$declare got text;begin begin execute query;exception when others then got:=sqlerrm;end;if got is distinct from message then raise exception 'EXPECTED:% GOT:%',message,got;end if;end$$;
do $$declare x jsonb; changed jsonb; result jsonb; before_plan jsonb; after_plan jsonb; outcome jsonb; stale text; vid uuid; initial_count bigint;
begin
 select data into x from pg_temp.name_input;
 select count(*) into initial_count from app.m9_rows;
 before_plan:=app.m9_catalog_plan(x->'payload',x->>'evidence_sha256');
 perform pg_temp.fail_if(jsonb_array_length(before_plan->'errors')=153,'default name guard');
 perform pg_temp.must_fail(format('select app.review_m9_names(%L::jsonb,%L::jsonb,%L,%L)',jsonb_set(x->'cases','{0,context_sha256}',to_jsonb(repeat('0',64))),x->'parents',x->>'source_sha256',x->>'evidence_sha256'),'M9_NAME_DESTINATION_CHANGED');
 perform pg_temp.must_fail(format('select app.review_m9_names(%L::jsonb,%L::jsonb,%L,%L)',jsonb_set(x->'cases','{0,rows,0,product_name}','"changed"'),x->'parents',x->>'source_sha256',x->>'evidence_sha256'),'M9_ROW_SOURCE_IDENTITY_CHANGED');
 changed:=jsonb_set(x->'cases','{0,rows,0,department}','"D1"');
 perform pg_temp.must_fail(format('select app.review_m9_names(%L::jsonb,%L::jsonb,%L,%L)',changed,x->'parents',x->>'source_sha256',x->>'evidence_sha256'),'M9_OTHER_CATALOG_CONTROLS_PENDING');
 perform pg_temp.fail_if((select count(*)=0 from app.m9_name_reviews),'failed evidence rolls back');
 update app.sicar_sync_control set catalog_writes_enabled=false where singleton;
 perform pg_temp.must_fail(format('select app.review_m9_names(%L::jsonb,%L::jsonb,%L,%L)',x->'cases',x->'parents',x->>'source_sha256',x->>'evidence_sha256'),'SICAR_CATALOG_SYNC_DISABLED');
 update app.sicar_sync_control set catalog_writes_enabled=true where singleton;
 result:=app.review_m9_names(x->'cases',x->'parents',x->>'source_sha256',x->>'evidence_sha256');
 perform pg_temp.fail_if(result->>'reviewed'='24','24 reviewed');
 result:=app.review_m9_names(x->'cases',x->'parents',x->>'source_sha256',x->>'evidence_sha256');
 perform pg_temp.fail_if(result->>'unchanged'='24','registration idempotent');
 after_plan:=app.m9_catalog_plan(x->'payload',x->>'evidence_sha256');
 perform pg_temp.fail_if(after_plan->>'write_allowed'='true','reviewed plan');
 perform pg_temp.fail_if(after_plan->>'token'<>before_plan->>'token','evidence changes token');
 perform pg_temp.must_fail(format('select app.m9_catalog_apply(%L::jsonb,%L,%L)',x->'payload',x->>'evidence_sha256',before_plan->>'token'),'M9_STALE_PREVIEW');
 -- A different row may not borrow a parent's name review.
 changed:=jsonb_set(x->'payload','{0,price_cents}','1');
 perform pg_temp.fail_if(app.m9_catalog_plan(changed,x->>'evidence_sha256')->>'write_allowed'='false','candidate payload bound');
 update app.m9_name_reviews set reviewed_at=clock_timestamp()-interval '25 hours';
 perform pg_temp.fail_if(app.m9_catalog_plan(x->'payload',x->>'evidence_sha256')->>'write_allowed'='false','expiration');
 update app.m9_name_reviews set reviewed_at=clock_timestamp();
 -- Destination edits invalidate all impacted cases and the plan token.
 select id into vid from public.products where search_name=lower(translate(x->'payload'->0->>'product_name','ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) limit 1;
 begin
 update public.products set name=name||' test' where id=vid;
 perform pg_temp.fail_if(app.m9_catalog_plan(x->'payload',x->>'evidence_sha256')->>'token'<>after_plan->>'token','destination stale');
 raise exception 'TEST_REVERT_EDIT';
 exception when others then if sqlerrm<>'TEST_REVERT_EDIT' then raise; end if;end;
 -- Control state must also invalidate evidence.
 update app.sicar_sync_control set catalog_writes_enabled=false where singleton;
 perform pg_temp.fail_if(app.m9_catalog_plan(x->'payload',x->>'evidence_sha256')->>'write_allowed'='false','disabled valid proof');
 update app.sicar_sync_control set catalog_writes_enabled=true where singleton;
 after_plan:=app.m9_catalog_plan(x->'payload',x->>'evidence_sha256');
 outcome:=app.m9_catalog_apply(x->'payload',x->>'evidence_sha256',after_plan->>'token');
 perform pg_temp.fail_if(outcome->>'created'='153' and outcome->>'updated'='0','create exact 153');
 after_plan:=app.m9_catalog_plan(x->'payload',x->>'evidence_sha256');
 outcome:=app.m9_catalog_apply(x->'payload',x->>'evidence_sha256',after_plan->>'token');
 perform pg_temp.fail_if(outcome->>'unchanged'='153' and outcome->>'created'='0','apply idempotent');
 perform pg_temp.fail_if((select count(*)=initial_count+153 from app.m9_rows),'managed count');
 perform pg_temp.fail_if((select count(*)=0 from public.inventory_by_location) and (select count(*)=0 from public.inventory_movements),'inventory untouched');
 perform pg_temp.fail_if(not has_function_privilege('authenticated','app.review_m9_names(jsonb,jsonb,text,text)','EXECUTE') and not has_function_privilege('anon','app.m9_name_review_valid(jsonb)','EXECUTE') and not has_function_privilege('service_role','app.m9_catalog_apply(jsonb,text,text)','EXECUTE'),'private privileges');
 perform pg_temp.fail_if(not(select bool_or(prosecdef) from pg_proc where oid in ('app.review_m9_names(jsonb,jsonb,text,text)'::regprocedure,'app.m9_name_review_valid(jsonb)'::regprocedure,'app.m9_name_context(text)'::regprocedure)),'security invoker');
end$$;
select jsonb_build_object('passed',true,'applied_and_repeated_in_rollback',153,'name_cases',24,'checks',20) as tests;
