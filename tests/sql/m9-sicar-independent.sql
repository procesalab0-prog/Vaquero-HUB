-- Run inside a transaction and roll back. Synthetic catalog only.
do $$
declare
 r jsonb := '{"barcode":"M9-SYNTHETIC-ONLY-0001","product_name":"M9 SYNTHETIC ONLY 20261006","family_key":"synthetic-only-20261006","woo_variation_id":null,"description":"TEST T.S","department":"PRUEBA","section":"M9 SYNTHETIC SECTION","price_cents":12345,"cost_cents":null,"attributes":{"TALLA":"S"}}';
 r2 jsonb; rows jsonb; p jsonb; result jsonb; vid uuid; before_bal bigint; before_mov bigint;
begin
 select count(*) into before_bal from public.inventory_by_location;
 select count(*) into before_mov from public.inventory_movements;
 r2:=r || '{"barcode":"M9-SYNTHETIC-ONLY-0002","attributes":{"TALLA":"M"},"description":"TEST T.M","department":"OTRO DEPARTAMENTO"}'::jsonb;
 rows:=jsonb_build_array(r,r2);
 p:=app.m9_sicar_plan(rows,repeat('a',64));
 if (p->>'write_allowed')::boolean then raise exception 'TEST_APPROVAL_BYPASS'; end if;
 insert into app.m9_sicar_approved_rows values(r->>'barcode',repeat('a',64),r,'SYNTHETIC TEST','rollback only',now());
 insert into app.m9_sicar_approved_rows values(r2->>'barcode',repeat('a',64),r2,'SYNTHETIC TEST','rollback only',now());
 p:=app.m9_sicar_plan(rows,repeat('a',64));
 if not (p->>'write_allowed')::boolean then raise exception 'TEST_PLAN %',p; end if;
 result:=app.m9_sicar_apply(rows,repeat('a',64),p->>'token');
 if result->>'created'<>'2' then raise exception 'TEST_CREATE %',result; end if;
 select variant_id into vid from app.m9_rows where barcode=r->>'barcode';
 if app.m9_sicar_current_row(vid) is distinct from r then raise exception 'TEST_READBACK'; end if;
 p:=app.m9_sicar_plan(rows,repeat('a',64));
 result:=app.m9_sicar_apply(rows,repeat('a',64),p->>'token');
 if result->>'unchanged'<>'2' or result->>'created'<>'0' then raise exception 'TEST_REPEAT'; end if;
 -- Duplicate requests never pass the planner.
 p:=app.m9_sicar_plan(jsonb_build_array(r,r),repeat('a',64));
 if (p->>'write_allowed')::boolean then raise exception 'TEST_DUPLICATE_ACCEPTED'; end if;
 -- Payloads cannot smuggle stock through this catalog path.
 begin
  perform app.m9_sicar_plan(jsonb_build_array(r || '{"existencia":99}'::jsonb),repeat('a',64));
  raise exception 'TEST_STOCK_FIELD_ACCEPTED';
 exception when others then
  if sqlerrm <> 'M9_UNKNOWN_OR_MISSING_FIELDS' then raise; end if;
 end;
 -- Removing approval invalidates a previously valid plan, even for no-op replay.
 p:=app.m9_sicar_plan(rows,repeat('a',64));
 delete from app.m9_sicar_approved_rows where barcode=r2->>'barcode';
 begin
  perform app.m9_sicar_apply(rows,repeat('a',64),p->>'token');
  raise exception 'TEST_REVOKED_APPROVAL_ACCEPTED';
 exception when others then
  if sqlerrm <> 'M9_STALE_PREVIEW' then raise; end if;
 end;
 insert into app.m9_sicar_approved_rows values(r2->>'barcode',repeat('a',64),r2,'SYNTHETIC TEST','rollback only',now());
 -- A refreshed, explicitly reviewed source price updates only its variant.
 r:=jsonb_set(r,'{price_cents}','12400');
 rows:=jsonb_build_array(r,r2);
 update app.m9_sicar_approved_rows set payload=r where barcode=r->>'barcode';
 p:=app.m9_sicar_plan(rows,repeat('a',64));
 result:=app.m9_sicar_apply(rows,repeat('a',64),p->>'token');
 if result->>'updated'<>'1' or result->>'unchanged'<>'1' or result->>'created'<>'0' then raise exception 'TEST_UPDATE %',result; end if;
 if app.m9_sicar_current_row(vid) is distinct from r then raise exception 'TEST_UPDATED_READBACK'; end if;
 if (select count(distinct v.product_id) from app.m9_rows mr join public.variants v on v.id=mr.variant_id where mr.barcode in (r->>'barcode',r2->>'barcode'))<>1 then raise exception 'TEST_FAMILY_SPLIT'; end if;
 p:=app.m9_sicar_plan(rows,repeat('a',64));
 -- A concurrent edit must invalidate both the token and the source baseline.
 update public.variants set price_cents=12346 where id=vid;
 begin
  perform app.m9_sicar_apply(rows,repeat('a',64),p->>'token');
  raise exception 'TEST_STALE_ACCEPTED';
 exception when others then
  if sqlerrm <> 'M9_STALE_PREVIEW' then raise; end if;
 end;
 p:=app.m9_sicar_plan(rows,repeat('a',64));
 if (p->>'write_allowed')::boolean then raise exception 'TEST_EDIT_OVERWRITTEN'; end if;
 if (select count(*) from public.inventory_by_location)<>before_bal or (select count(*) from public.inventory_movements)<>before_mov then raise exception 'TEST_INVENTORY_CHANGED'; end if;
 if has_function_privilege('authenticated','app.m9_sicar_apply(jsonb,text,text)','EXECUTE') or has_function_privilege('service_role','app.m9_sicar_apply(jsonb,text,text)','EXECUTE') or has_function_privilege('anon','app.m9_sicar_plan(jsonb,text)','EXECUTE') then raise exception 'TEST_PERMISSIONS'; end if;
end;
$$;
