create or replace function app.remote_web_packet(pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a app.web_remote_family_approvals; d app.web_product_drafts; s app.web_content_sources;
 c jsonb; b jsonb; f app.web_lab_family_evidence; v jsonb; expected jsonb; actual jsonb; children jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into a from app.web_remote_family_approvals where product_id=pid;
 if not found then return app.remote_web_simple_packet(pid); end if;
 select * into strict d from app.web_product_drafts where product_id=pid;
 select * into strict s from app.web_content_sources where product_id=pid;
 select * into strict f from app.web_lab_family_evidence where product_id=pid;
 c:=app.web_catalog_snapshot(pid);b:=app.web_category_binding_state(pid);
 if md5(c::text)<>a.catalog_fingerprint or md5(s.snapshot::text)<>a.source_fingerprint or s.source_sha256<>a.source_sha256
  or f.catalog_fingerprint<>a.catalog_fingerprint or f.source_fingerprint<>a.source_fingerprint or f.source_sha256<>a.source_sha256
  or s.snapshot->>'type'<>'variable' or coalesce((b->>'valid')::boolean,false)=false
  or c->>'active'<>'true' or jsonb_array_length(c->'variants') not between 2 and 100 then raise exception 'REMOTE_FAMILY_EVIDENCE_CHANGED'; end if;
 perform app.validate_web_content(d.content);
 if length(d.content->>'name')>200 or length(btrim(d.content->>'description'))=0 or length(d.content->>'description')>20000
  or length(btrim(d.content->>'short_description'))=0 or length(d.content->>'short_description')>2000
  or d.content->>'short_description'<>d.content->>'base_code' or jsonb_array_length(d.content->'images') not between 1 and 20
 then raise exception 'REMOTE_CONTENT_SCOPE'; end if;
 select jsonb_agg(id order by id) into expected from (
  select (value->>'woo_variation_id')::bigint id from jsonb_array_elements(s.snapshot->'variants')
  union all select value::bigint from jsonb_array_elements_text(s.snapshot->'unselected_woo_variation_ids')
 ) q;
 select jsonb_agg((value->>'woo_variation_id')::bigint order by (value->>'woo_variation_id')::bigint) into actual from jsonb_array_elements(c->'variants');
 if expected is null or actual is distinct from expected then raise exception 'REMOTE_INCOMPLETE_FAMILY'; end if;
 for v in select value from jsonb_array_elements(c->'variants') loop
  if v->>'active'<>'true' or v->'attributes'='{}'::jsonb or nullif(v->>'barcode','') is null
   or length(v->>'barcode')>100 or (v->>'price_cents')::bigint not between 0 and 100000000
   or v->>'woo_product_id' is distinct from s.snapshot->>'woo_product_id'
   or not exists(select 1 from app.m9_rows r where r.variant_id=(v->>'id')::uuid and r.barcode=v->>'barcode' and r.source_row=app.m9_current_row(r.variant_id))
   then raise exception 'REMOTE_VARIANT_REVIEW'; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('variant_id',q.value->'id','barcode',q.value->'barcode','price_cents',q.value->'price_cents','attributes',q.value->'attributes') order by q.value->>'id') into children from jsonb_array_elements(c->'variants') q(value);
 if (select count(distinct q.value->>'barcode') from jsonb_array_elements(children) q(value))<>jsonb_array_length(children)
  or (select count(distinct q.value->'attributes') from jsonb_array_elements(children) q(value))<>jsonb_array_length(children)
 then raise exception 'REMOTE_DUPLICATE_VARIANT'; end if;
 return jsonb_build_object('protocol','m9-remote-family-1','product_id',pid,'revision',d.revision,'fingerprint',md5(c::text),
  'content',d.content,'barcode','M9-P-'||pid::text,'variants',children,
  'descriptive_attributes',coalesce((select jsonb_agg(value order by n) from jsonb_array_elements(s.snapshot->'parent_attributes_source') with ordinality x(value,n) where value->>'variation'='false'),'[]'::jsonb),
  'origin','https://salmon-nightingale-251188.hostingersite.com');
end $$;
