-- Called inside a ROLLBACK transaction with pg_temp.census_test_input(payload).
create temporary table census_test_results(result jsonb) on commit drop;
do $$
declare p jsonb;bad jsonb;r jsonb;r2 jsonb;k text;wanted text;caught boolean;checks integer:=0;idx integer;q jsonb;
begin
 select payload into strict p from pg_temp.census_test_input;
 foreach k in array array['scope','permission_field','future','missing_amount','numeric_ref','identity','duplicate','doc_id','doc_total','doc_payment','previous','previous_missing','name'] loop
  bad:=p;wanted:='CENSUS_SCOPE_INVALID';
  case k
   when 'scope' then bad:=jsonb_set(bad,'{scope}','"ALL_CUSTOMERS_AND_PAID_HISTORY"');
   when 'permission_field' then bad:=bad||'{"operational_import_allowed":true}';
   when 'future' then bad:=jsonb_set(bad,'{observed_until}',to_jsonb(clock_timestamp()+interval '1 day'));wanted:='CENSUS_DATE_INVALID';
   when 'missing_amount' then bad:=jsonb_set(bad,'{accounts,0,used_cents}','null');wanted:='CENSUS_AMOUNT_INVALID';
   when 'numeric_ref' then bad:=jsonb_set(bad,'{accounts,0,ref}','1234');wanted:='CENSUS_ACCOUNT_INVALID';
   when 'identity' then bad:=jsonb_set(bad,'{accounts,0,key}',to_jsonb(repeat('a',64)));wanted:='CENSUS_IDENTITY_CHANGED';
   when 'duplicate' then bad:=jsonb_set(bad,'{accounts,1}',p->'accounts'->0);wanted:='CENSUS_IDENTITY_DUPLICATE';
   when 'doc_id' then
    select ord-1 into idx from jsonb_array_elements(p->'accounts') with ordinality a(x,ord) where jsonb_array_length(x->'documents')>0 limit 1;
    bad:=jsonb_set(bad,array['accounts',idx::text,'documents','0','key'],to_jsonb(repeat('b',64)));wanted:='CENSUS_DOCUMENT_IDENTITY_CHANGED';
   when 'doc_total' then bad:=jsonb_set(bad,'{accounts,0,used_cents}',to_jsonb((p->'accounts'->0->>'used_cents')::bigint+1));wanted:='CENSUS_TOTALS_CHANGED';
   when 'doc_payment' then bad:=jsonb_set(bad,'{accounts,0}',(p->'accounts'->0)||'{"privacy_consent":true}');wanted:='CENSUS_ACCOUNT_INVALID';
   when 'previous' then bad:=jsonb_set(bad,'{accounts,0,previously_registered}',to_jsonb(not (p->'accounts'->0->>'previously_registered')::boolean));wanted:='CENSUS_PREVIOUS_IDENTITY_CHANGED';
   when 'previous_missing' then
    bad:=jsonb_set(bad,'{accounts}',(select jsonb_agg(x) from jsonb_array_elements(p->'accounts') x where x->'previously_registered'='false'::jsonb));wanted:='CENSUS_PREVIOUS_SCOPE_MISSING';
   when 'name' then bad:=jsonb_set(bad,'{accounts,0,name}','""');wanted:='CENSUS_ACCOUNT_INVALID';
  end case;
  -- New archive hash avoids replay short-circuit when repeating fixture after persistence.
  bad:=jsonb_set(bad,'{source_plan_sha256}',to_jsonb(encode(extensions.digest('qa/'||k,'sha256'),'hex')));
  caught:=false;begin perform app.m9_archive_general_census(bad);
  exception when others then
   if k='doc_total' and sqlerrm='CENSUS_PREVIOUS_BALANCE_CHANGED' then caught:=true;
   elsif sqlerrm=wanted then caught:=true;else raise exception 'EXPECTED %, GOT % (%)',wanted,sqlerrm,k;end if;
  end;
  if not caught then raise exception 'CENSUS_EXPECTED_REJECTION %',k;end if;checks:=checks+1;
 end loop;
 r:=app.m9_archive_general_census(p);r2:=app.m9_archive_general_census(p);
 if r->>'archive'<>r2->>'archive' or r2->'replayed'<>'true'::jsonb or r->'operational_import_allowed'<>'false'::jsonb then raise exception 'CENSUS_REPLAY_FAILED';end if;
 caught:=false;begin perform app.m9_archive_general_census(jsonb_set(p,'{accounts,0,name}','"Replay cambiado"'));
 exception when others then if sqlerrm<>'CENSUS_REPLAY_CHANGED' then raise;end if;caught:=true;end;
 if not caught then raise exception 'CENSUS_REPLAY_MUTABLE';end if;checks:=checks+1;
 caught:=false;begin update app.m9_customer_census_archives set receipt='{}' where source_plan_sha256=p->>'source_plan_sha256';
 exception when others then if sqlerrm<>'M9_LEGACY_EVENT_IMMUTABLE' then raise;end if;caught:=true;end;
 if not caught then raise exception 'CENSUS_ARCHIVE_MUTABLE';end if;checks:=checks+1;
 q:=public.m9_general_migration_read('{}');
 if q->'summary'->'accounts'<>r->'accounts' or q->'operational_import_allowed'<>'false'::jsonb or jsonb_array_length(q->'rows')>20 then raise exception 'CENSUS_LIST_INVALID';end if;
 if (public.m9_general_migration_read('{"filter":"additional"}')->>'total')::integer<>(r->>'additional_accounts')::integer then raise exception 'CENSUS_FILTER_FAILED';end if;
 if (public.m9_general_migration_read('{"q":"%_"}')->>'total')::integer<>0 then raise exception 'CENSUS_SEARCH_WILDCARDS';end if;
 foreach bad in array array['{"page":0}'::jsonb,'{"q":{}}'::jsonb,'{"filter":"approve"}'::jsonb,'{"operation":"COLLECT"}'::jsonb] loop
  caught:=false;begin perform public.m9_general_migration_read(bad);exception when others then if sqlerrm<>'CENSUS_QUERY_INVALID' then raise;end if;caught:=true;end;
  if not caught then raise exception 'CENSUS_QUERY_NOT_BLOCKED';end if;checks:=checks+1;
 end loop;
 if has_table_privilege('authenticated','app.m9_customer_census_archives','SELECT') or has_table_privilege('service_role','app.m9_customer_census_archives','INSERT') or
  has_function_privilege('anon','public.m9_general_migration_read(jsonb)','EXECUTE') or has_function_privilege('authenticated','app.m9_archive_general_census(jsonb)','EXECUTE') then raise exception 'CENSUS_ACL_LEAK';end if;
 execute 'set local role authenticated';
 q:=public.m9_general_migration_read('{}');
 if q->'summary'->'accounts'<>r->'accounts' then raise exception 'CENSUS_AUTHENTICATED_LIST_FAILED';end if;
 caught:=false;begin perform app.m9_archive_general_census(p);exception when insufficient_privilege then caught:=true;end;
 if not caught then raise exception 'CENSUS_AUTHENTICATED_IMPORT_ALLOWED';end if;
 execute 'reset role';checks:=checks+1;
 execute 'set local role anon';caught:=false;
 begin perform public.m9_general_migration_read('{}');exception when insufficient_privilege then caught:=true;end;
 if not caught then raise exception 'CENSUS_ANON_READ_ALLOWED';end if;
 execute 'reset role';checks:=checks+1;
 perform set_config('request.jwt.claims','{}',true);caught:=false;
 begin perform public.m9_general_migration_read('{}');exception when others then if sqlerrm<>'NOT_AUTHORIZED' then raise;end if;caught:=true;end;
 if not caught then raise exception 'CENSUS_ACTOR_REQUIRED';end if;checks:=checks+1;
 insert into census_test_results values(jsonb_build_object('negative_checks',checks,'archive_accounts',r->'accounts','documents',r->'documents','replay',true,'immutable',true,'operational_import_allowed',false));
end $$;
select result from census_test_results;
