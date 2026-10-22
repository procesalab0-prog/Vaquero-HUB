-- READ ONLY RPC acceptance. Set a staging ADMIN claim before running.
begin read only;
set local statement_timeout='30s';
set local role authenticated;
do $$declare p jsonb;begin
 p:=public.m9_parallel_readonly_overview();
 if p->>'protocol'<>'m9-parallel-overview-1' or p->'read_only'<>'true'::jsonb or p->'operational_authorization'<>'false'::jsonb then raise exception 'OVERVIEW_SCOPE_FAILED';end if;
 if p ? 'rows' or p ? 'accounts' or p ? 'names' then raise exception 'OVERVIEW_PRIVATE_RECORDS_EXPOSED';end if;
 if p->'catalog'->'copied_photos_are_not_current_eligibility'<>'true'::jsonb or p->'customers'->'historical_archive_is_not_opening'<>'true'::jsonb or p->'woo'->'rehearsal_does_not_prove_gateway'<>'true'::jsonb then raise exception 'OVERVIEW_DOMAIN_GUARD_FAILED';end if;
end $$;
select public.m9_parallel_readonly_overview()as overview;
rollback;
