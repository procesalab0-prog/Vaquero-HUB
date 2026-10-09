begin;
create or replace function app.web_lab_packet(pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d app.web_product_drafts; s app.web_content_sources; e app.web_lab_enabled_products; c jsonb; b jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into e from app.web_lab_enabled_products where product_id=pid and enabled;
 if not found then raise exception 'LAB_NOT_ENABLED'; end if;
 select * into s from app.web_content_sources where product_id=pid;
 if s.product_id is null or s.snapshot->>'type' is distinct from 'simple' or md5(s.snapshot::text)<>e.source_fingerprint then raise exception 'LAB_SOURCE_CHANGED'; end if;
 select * into d from app.web_product_drafts where product_id=pid;
 if d.product_id is null then raise exception 'LAB_SAVE_REQUIRED'; end if;
 perform app.validate_web_content(d.content);
 b:=app.web_category_binding_state(pid);
 if coalesce((b->>'valid')::boolean,false)=false then raise exception 'LAB_CATEGORY_REVIEW'; end if;
 c:=app.web_catalog_snapshot(pid);
 if c->>'active'<>'true' or jsonb_array_length(c->'variants')<>1
   or c#>>'{variants,0,active}'<>'true' or c#>'{variants,0,attributes}'<>'{}'::jsonb
   or coalesce(jsonb_array_length(s.snapshot->'unselected_woo_variation_ids'),0)<>0
   or nullif(c#>>'{variants,0,barcode}','') is null or nullif(c#>>'{variants,0,sku}','') is null
   or (c#>>'{variants,0,price_cents}')::bigint<=0
   then raise exception 'LAB_SIMPLE_PRODUCT_ONLY'; end if;
 if length(btrim(d.content->>'description'))=0 or length(btrim(d.content->>'base_code'))=0
   or d.content->>'short_description'<>d.content->>'base_code'
   or jsonb_array_length(d.content->'images')=0 then raise exception 'LAB_INCOMPLETE_CONTENT'; end if;
 return jsonb_build_object('version',1,'store',jsonb_build_object('id',e.store_id,'base_url','http://127.0.0.1:9417','environment','LOCAL_WOO_TEST'),
 'product_id',pid,'revision',d.revision,'mode','create','type','simple','content',d.content,
 'catalog',c,'fingerprint',md5(c::text),'category_evidence',b,'source_fingerprint',e.source_fingerprint);
end $$;
revoke all on function app.web_lab_packet(uuid) from public,anon,authenticated,service_role;

commit;
