-- Run after the migration body inside BEGIN ... ROLLBACK. Fixtures never persist.
create function pg_temp.reject_pending(p_rows jsonb,expected text) returns void language plpgsql as $$
begin
 begin perform app.load_m9_pending_review(repeat('a',64),p_rows);
 exception when others then if sqlerrm=expected then return; else raise; end if; end;
 raise exception 'EXPECTED_REJECTION_%',expected;
end $$;
do $$
declare r jsonb; got jsonb; actor uuid; n integer; tests integer:=0;
begin
 select count(*) into n from app.m9_rows;
 insert into app.m9_review_cuts(cut_sha,sicar_sha,woo_sha,source_count,managed_count,expected_count) values(repeat('a',64),repeat('b',64),repeat('c',64),n+1,n,1);
 r:=jsonb_build_object('barcode','__M9_TEST_PENDING__','description','Literal <script>','department','D1','section','C1','retail_source','0','price_cents',null,'classification','SICAR_ONLY','reasons',jsonb_build_array('REVIEW'),'candidate_woo_ids','[]'::jsonb);
 got:=app.load_m9_pending_review(repeat('a',64),jsonb_build_array(r));
 if got->>'created'<>'1' or got->>'catalog_created'<>'0' then raise exception 'INTAKE_FAILED'; end if; tests:=tests+1;
 got:=app.load_m9_pending_review(repeat('a',64),jsonb_build_array(r));
 if got->>'created'<>'0' or got->>'unchanged'<>'1' then raise exception 'IDEMPOTENCY_FAILED'; end if; tests:=tests+1;
 perform pg_temp.reject_pending(jsonb_build_array(r||'{"stock":1}'),'M9_UNKNOWN_FIELDS');tests:=tests+1;
 perform pg_temp.reject_pending(jsonb_build_array(r||'{"cost_cents":0}'),'M9_UNKNOWN_FIELDS');tests:=tests+1;
 perform pg_temp.reject_pending(jsonb_build_array(r||'{"approved":true}'),'M9_UNKNOWN_FIELDS');tests:=tests+1;
 perform pg_temp.reject_pending(jsonb_build_array(r,r),'M9_DUPLICATE_CODE');tests:=tests+1;
 perform pg_temp.reject_pending(jsonb_build_array(r||'{"description":"Changed"}'),'M9_EVIDENCE_CHANGED');tests:=tests+1;
 perform pg_temp.reject_pending(jsonb_build_array(r||'{"price_cents":0}'),'M9_INVALID_ROW');tests:=tests+1;
 perform pg_temp.reject_pending(jsonb_build_array(r||'{"candidate_woo_ids":[null]}'),'M9_INVALID_ROW');tests:=tests+1;
 perform pg_temp.reject_pending(jsonb_build_array(r||jsonb_build_object('barcode',(select barcode from app.m9_rows limit 1))),'M9_ALREADY_MANAGED');tests:=tests+1;
 update app.m9_review_cuts set ready=true where cut_sha=repeat('a',64);
 perform pg_temp.reject_pending(jsonb_build_array(r||'{"barcode":"__OTHER__"}'),'M9_SEALED_CUT');tests:=tests+1;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.m9_pending_catalog();raise exception 'ANONYMOUS_ACCEPTED';exception when insufficient_privilege then null;end;tests:=tests+1;
 select updated_by into actor from app.web_product_drafts where updated_by is not null limit 1;
 if actor is null then raise exception 'TEST_ACTOR_REQUIRED'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 got:=public.m9_pending_catalog('__M9_TEST_PENDING__',true,1);
 if got->>'total'<>'1' or got->>'send_allowed'<>'false' or got->>'status'<>'PENDING_MANUAL_REVIEW' then raise exception 'READ_FAILED';end if;tests:=tests+1;
 if got->'rows'->0->>'barcode'<>'__M9_TEST_PENDING__' or got->'rows'->0->'price_cents'<>'null'::jsonb then raise exception 'LITERAL_OR_NULL_LOST';end if;tests:=tests+1;
 got:=public.m9_pending_catalog('script',false,1);if got->>'total'<>'1' then raise exception 'TEXT_SEARCH_FAILED';end if;tests:=tests+1;
 got:=public.m9_pending_catalog('',false,2);if jsonb_array_length(got->'rows')<>0 then raise exception 'PAGINATION_FAILED';end if;tests:=tests+1;
 begin perform public.m9_pending_catalog('',false,0);raise exception 'BAD_PAGE_ACCEPTED';exception when raise_exception then if sqlerrm<>'INVALID_REVIEW_FILTER' then raise;end if;end;tests:=tests+1;
 if has_table_privilege('authenticated','app.m9_pending_review','SELECT') or has_table_privilege('anon','app.m9_pending_review','SELECT') or has_function_privilege('anon','public.m9_pending_catalog(text,boolean,integer)','EXECUTE') or has_function_privilege('authenticated','app.load_m9_pending_review(text,jsonb)','EXECUTE') then raise exception 'PRIVILEGES_LEAKED';end if;tests:=tests+1;
 if (select count(*) from app.m9_rows)<>n then raise exception 'CATALOG_CHANGED';end if;tests:=tests+1;
 create temporary table pending_test_results as select tests as passed;
end $$;
select * from pending_test_results;
