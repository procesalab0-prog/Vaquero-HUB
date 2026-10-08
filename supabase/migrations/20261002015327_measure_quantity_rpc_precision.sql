begin;
-- Validate original numeric inputs BEFORE numeric(12,3)/integer coercion.
-- Does not enable fractional units: the assignment gate remains in place.
create function app.assert_measure_items(p_items jsonb,p_quantity_key text)
returns void language plpgsql security definer set search_path='' as $$
declare i jsonb; q numeric; v uuid;
begin
 if app.current_user_id() is null then raise exception 'NOT_AUTHENTICATED' using errcode='28000'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'INVALID_MEASURE_ITEMS' using errcode='22023'; end if;
 if jsonb_array_length(p_items)>500 or pg_column_size(p_items)>1048576 then raise exception 'INVALID_MEASURE_ITEMS' using errcode='22023'; end if;
 for i in select value from jsonb_array_elements(p_items) loop
  if i ? 'quick' then perform app.assert_quick_pos_item(i); continue; end if;
  begin v:=(i->>'variant_id')::uuid; q:=(i->>p_quantity_key)::numeric;
  exception when others then raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023'; end;
  if not app.valid_measure_quantity(v,q) then raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023'; end if;
 end loop;
end; $$;
revoke all on function app.assert_measure_items(jsonb,text) from public,anon,authenticated,service_role;

do $patch$
declare f regprocedure; s text; code text; patched text; name text;
begin
 for f,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='app' and p.proname in ('create_sale_engine','assert_pos_draft_items','assert_quote_items','apply_movement'))
     or (n.nspname='public' and p.proname in ('create_layaway','create_transfer','prepare_transfer','receive_transfer','record_inventory_count_item','apply_inventory_adjustment'))
 loop
  s:=pg_get_functiondef(f);
  code:=case
   when name='apply_movement' then $s$if not app.valid_measure_quantity(p_variant_id,p_qty) then raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023'; end if;$s$
   when name='record_inventory_count_item' then $s$if not app.valid_measure_quantity(p_variant_id,p_counted_qty) then raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023'; end if;$s$
   when name='apply_inventory_adjustment' then $s$if not app.valid_measure_quantity(p_variant_id,p_counted_qty) or not app.valid_measure_quantity(p_variant_id,p_expected_qty) then raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023'; end if;$s$
   when name in ('create_transfer','prepare_transfer','receive_transfer') then $s$perform app.assert_measure_items(p_items,'qty');$s$
   else $s$perform app.assert_measure_items(p_items,'quantity');$s$
  end;
  patched:=regexp_replace(s,E'\n(begin|BEGIN)\n',E'\nbegin\n  if app.current_user_id() is null then raise exception ''NOT_AUTHENTICATED'' using errcode=''28000''; end if;\n  '||code||E'\n');
  if patched=s then raise exception 'MEASURE_MIGRATION_SOURCE_CHANGED: %',f; end if;
  execute patched;
 end loop;
end; $patch$;
commit;
