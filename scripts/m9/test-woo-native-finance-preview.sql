-- Staging only. Authenticated RPC, synthetic internal rollback, outer rollback of audit.
begin;
set local statement_timeout='120s';
select app.assert_sicar_staging_enabled();
select set_config('request.jwt.claim.sub','2b5e4ba1-00f2-48c7-bbe0-273340629711',true);
create temporary table woo_preview_results(result jsonb) on commit drop;
grant insert on woo_preview_results to authenticated;
do $$declare r text; f text; begin
 foreach r in array array['anon','authenticated','service_role'] loop
  foreach f in array array['app.m9_woo_native_finance(jsonb)','app.m9_woo_native_rehearsal(uuid)','app.m9_woo_rehearsal_evidence(bigint,jsonb,text,uuid)']loop
   if has_function_privilege(r,f,'execute')then raise exception 'PRIVATE_FUNCTION_EXPOSED % %',r,f;end if;
  end loop;
  if has_table_privilege(r,'app.m9_woo_native_finance_rehearsals','select,insert,update,delete')then raise exception 'AUDIT_TABLE_EXPOSED %',r;end if;
 end loop;
 if has_function_privilege('anon','public.m9_run_woo_native_rehearsal(uuid,uuid)','execute')or has_function_privilege('service_role','public.m9_run_woo_native_rehearsal(uuid,uuid)','execute')then raise exception 'PUBLIC_RPC_EXPOSED';end if;
end $$;
set local role authenticated;
do $$declare ctx jsonb;a jsonb;b jsonb;op uuid:=gen_random_uuid();sid uuid:='69d25da1-1b31-4f94-928f-77ad0708846a';begin
 ctx:=public.m9_woo_native_rehearsal_context();
 if ctx->'synthetic_only'<>'true'::jsonb or ctx->'operational_activation_allowed'<>'false'::jsonb or not exists(select 1 from jsonb_array_elements(ctx->'sessions')s where s->>'id'=sid::text)then raise exception 'CONTEXT_FAILED';end if;
 begin perform public.m9_run_woo_native_rehearsal(gen_random_uuid(),op);raise exception 'FOREIGN_SESSION_ACCEPTED';exception when insufficient_privilege then if sqlerrm<>'WOO_REHEARSAL_OWN_SESSION_REQUIRED'then raise;end if;end;
 a:=public.m9_run_woo_native_rehearsal(sid,op);b:=public.m9_run_woo_native_rehearsal(sid,op);
 if a->>'id'<>b->>'id' or b->'replayed'<>'true'::jsonb or a->'result'->'all_synthetic_operations_rolled_back'<>'true'::jsonb then raise exception 'RPC_REPLAY_OR_ROLLBACK_FAILED';end if;
 begin perform public.m9_run_woo_native_rehearsal(sid,gen_random_uuid());raise exception 'COOLDOWN_MISSING';exception when others then if sqlerrm<>'WOO_REHEARSAL_COOLDOWN'then raise;end if;end;
 insert into woo_preview_results values(jsonb_build_object('authenticated_rpc',true,'own_session_required',true,'cooldown_verified',true,'replay_same_receipt',true,'private_function_acl_checks',9,'private_table_acl_checks',3,'public_rpc_denials',2,'result',a->'result'));
end $$;
reset role;
select * from woo_preview_results;
rollback;
