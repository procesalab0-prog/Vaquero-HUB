begin;
-- JSON containment would accept a subset of nested attributes. Require the
-- complete reviewed row, including every attribute and every top-level field.
create or replace function app.m9_name_review_valid(r jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from app.m9_name_reviews n
 where exists(select 1 from app.sicar_sync_control where singleton and environment_label='STAGING' and catalog_writes_enabled)
 and n.woo_id=(r->>'woo_product_id')::bigint
 and exists(select 1 from jsonb_array_elements(n.rows) reviewed where reviewed.value=r)
 and n.reviewed_at<=statement_timestamp()+interval '5 minutes'
 and n.reviewed_at>=statement_timestamp()-interval '24 hours'
 and n.context_sha256=encode(extensions.digest(app.m9_name_context(r->>'product_name')::text,'sha256'),'hex'))
$$;
revoke all on function app.m9_name_review_valid(jsonb) from public,anon,authenticated,service_role;
commit;
