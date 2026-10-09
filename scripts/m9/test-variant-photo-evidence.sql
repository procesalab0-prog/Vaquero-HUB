create function pg_temp.import_photos(a jsonb) returns jsonb language sql as $$
 select app.import_variant_photo_evidence((a->>'product_id')::uuid,a->>'catalog_hash',a->>'source_hash',
 a->>'draft_hash',a->>'export_hash',a->'items')
$$;
create function pg_temp.reject_photos(a jsonb,wanted text) returns void language plpgsql as $$
begin
 begin perform pg_temp.import_photos(a);
 exception when others then if sqlerrm=wanted then return; end if; raise exception 'EXPECTED_%,_GOT_%',wanted,sqlerrm; end;
 raise exception 'EXPECTED_REJECTION_%',wanted;
end $$;
do $test$
declare a jsonb; r jsonb; before_sources text; before_drafts text; before_rows text; before_categories text; audit_count bigint;
begin
 select data into a from variant_photo_case;
 select md5(jsonb_agg(to_jsonb(s) order by product_id)::text) into before_sources from app.web_content_sources s;
 select md5(jsonb_agg(to_jsonb(d) order by product_id)::text) into before_drafts from app.web_product_drafts d;
 select md5(jsonb_agg(to_jsonb(mrow) order by barcode)::text) into before_rows from app.m9_rows mrow;
 select md5(jsonb_agg(to_jsonb(b) order by product_id)::text) into before_categories from app.web_category_bindings b;
 perform pg_temp.reject_photos(jsonb_set(a,'{catalog_hash}','"changed"'),'VARIANT_PHOTO_EXPECTATION_CHANGED');
 perform pg_temp.reject_photos(jsonb_set(a,'{source_hash}','"changed"'),'VARIANT_PHOTO_EXPECTATION_CHANGED');
 perform pg_temp.reject_photos(jsonb_set(a,'{draft_hash}','"changed"'),'VARIANT_PHOTO_EXPECTATION_CHANGED');
 perform pg_temp.reject_photos(jsonb_set(a,'{export_hash}','"invalid"'),'INVALID_VARIANT_PHOTO_PACKET');
 perform pg_temp.reject_photos(jsonb_set(a,'{items}','[]'),'INVALID_VARIANT_PHOTO_PACKET');
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,barcode}','"wrong"'),'VARIANT_PHOTO_IDENTITY_REVIEW');
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,woo_product_id}','999999'),'VARIANT_PHOTO_IDENTITY_REVIEW');
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,source_variant,status}','"draft"'),'VARIANT_PHOTO_IDENTITY_REVIEW');
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,source_variant,id}','999999'),'VARIANT_PHOTO_IDENTITY_REVIEW');
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,photos,0,url}','"https://evil.example/a.jpg"'),'INVALID_VARIANT_PHOTO_BYTES_EVIDENCE');
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,photos,0,sha256}','"bad"'),'INVALID_VARIANT_PHOTO_BYTES_EVIDENCE');
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,photos,0,bytes}','4194305'),'INVALID_VARIANT_PHOTO_BYTES_EVIDENCE');
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,photos,0,mime}','null'),'INVALID_VARIANT_PHOTO_BYTES_EVIDENCE');
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,source_variant,images}','"different"'),'VARIANT_PHOTO_SOURCE_URL_CHANGED');
 perform pg_temp.reject_photos(jsonb_set(a,'{items}',jsonb_build_array(a#>'{items,0}',a#>'{items,0}')),'DUPLICATE_VARIANT_PHOTO_ITEM');
 if has_function_privilege('authenticated','app.import_variant_photo_evidence(uuid,text,text,text,text,jsonb)','EXECUTE')
  or has_function_privilege('anon','app.import_variant_photo_evidence(uuid,text,text,text,text,jsonb)','EXECUTE')
  or has_function_privilege('service_role','app.import_variant_photo_evidence(uuid,text,text,text,text,jsonb)','EXECUTE')
  or has_table_privilege('authenticated','app.web_variant_photo_evidence','UPDATE')
  or has_table_privilege('anon','app.web_variant_photo_evidence','SELECT') then raise exception 'PHOTO_PERMISSIONS_EXPOSED'; end if;
 r:=pg_temp.import_photos(a);
 if (r->>'created')::integer<>jsonb_array_length(a->'items') then raise exception 'PHOTO_CREATE_FAILED'; end if;
 select count(*) into audit_count from public.audit_log;
 r:=pg_temp.import_photos(a);
 if (r->>'created')::integer<>0 or (r->>'unchanged')::integer<>jsonb_array_length(a->'items')
  or audit_count<>(select count(*) from public.audit_log) then raise exception 'PHOTO_REPEAT_FAILED'; end if;
 perform pg_temp.reject_photos(jsonb_set(a,'{items,0,photos,0,alt}','"changed"'),'VARIANT_PHOTO_ALREADY_EDITED');
 if before_sources is distinct from(select md5(jsonb_agg(to_jsonb(s) order by product_id)::text) from app.web_content_sources s)
  or before_drafts is distinct from(select md5(jsonb_agg(to_jsonb(d) order by product_id)::text) from app.web_product_drafts d)
  or before_rows is distinct from(select md5(jsonb_agg(to_jsonb(mrow) order by barcode)::text) from app.m9_rows mrow)
  or before_categories is distinct from(select md5(jsonb_agg(to_jsonb(b) order by product_id)::text) from app.web_category_bindings b)
  then raise exception 'UNRELATED_DATA_CHANGED'; end if;
 if exists(select 1 from public.inventory_by_location) or exists(select 1 from public.inventory_movements) then raise exception 'INVENTORY_CHANGED'; end if;
end $test$;
select jsonb_build_object('checks',21,'rollback_required',true) as result;
