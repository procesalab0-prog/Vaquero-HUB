begin;
-- Forward-only groundwork. Product assignment remains gated until the UI and
-- every receipt/report path have passed acceptance. Existing ledgers are not
-- rewritten, and PIECE/PAIR still reject fractional quantities.
select set_config('app.measure_sales_view',pg_get_viewdef('app.sales_report_lines'::regclass,true),true);
drop view app.sales_report_lines;
alter table public.sale_items alter column quantity type numeric;
alter table public.return_items alter column quantity type numeric;
alter table public.return_items drop constraint return_item_piece_quantity_integer;
alter table public.quote_items drop constraint quote_items_quantity_check;
alter table public.quote_items drop constraint quote_items_line_total_cents_check;
alter table public.quote_items alter column quantity type numeric;
alter table public.quote_items add constraint quote_items_quantity_check check(quantity>0 and quantity<=999);
alter table public.quote_items add constraint quote_items_line_total_cents_check
 check(line_total_cents=round(quantity*unit_price_cents)::bigint-discount_cents and line_total_cents>=0);
alter table public.layaway_items alter column quantity type numeric;
alter table public.layaway_items drop constraint layaway_items_quantity_check;
alter table public.layaway_items add constraint layaway_items_quantity_check check(quantity>0);
alter table public.inventory_reservation_movements alter column quantity type numeric;
alter table public.inventory_reservation_movements alter column previous_reserved_qty type numeric;
alter table public.inventory_reservation_movements alter column new_reserved_qty type numeric;
alter table public.inventory_reservation_movements drop constraint inventory_reservation_movements_quantity_check;
alter table public.inventory_reservation_movements add constraint inventory_reservation_movements_quantity_check check(quantity<>0);
alter table public.layaway_item_substitutions alter column quantity type numeric;
alter table public.layaway_item_substitutions drop constraint layaway_item_substitutions_quantity_check;
alter table public.layaway_item_substitutions add constraint layaway_item_substitutions_quantity_check check(quantity>0);

create function app.guard_commercial_measure_quantity() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_variant uuid; v_q numeric:=new.quantity;
begin
 v_variant:=case when tg_table_name='layaway_item_substitutions' then (to_jsonb(new)->>'new_variant_id')::uuid else (to_jsonb(new)->>'variant_id')::uuid end;
 if v_q is null or v_q::text in ('NaN','Infinity','-Infinity') or abs(v_q)>999999999.999
    or (v_variant is not null and not app.valid_measure_quantity(v_variant,v_q))
    or (v_variant is null and (v_q<>trunc(v_q) or v_q not between 1 and 999)) then
  raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023';
 end if;
 if tg_table_name='inventory_reservation_movements' then
  if not app.valid_measure_quantity(v_variant,new.previous_reserved_qty)
     or not app.valid_measure_quantity(v_variant,new.new_reserved_qty) then
   raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023';
  end if;
 end if;
 return new;
end; $$;
revoke all on function app.guard_commercial_measure_quantity() from public,anon,authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['sale_items','return_items','quote_items','layaway_items','inventory_reservation_movements','layaway_item_substitutions'] loop
  execute format('create trigger commercial_measure_quantity_guard before insert or update on public.%I for each row execute function app.guard_commercial_measure_quantity()',t);
 end loop;
end; $$;

-- Exact, checked substitutions retain current permission checks, ledger guards,
-- advisory/row locks, idempotency and supervisor authorization. Fail rather than
-- silently applying a patch to an unexpected function body.
create function app.patch_commercial_measure(p_function regprocedure,p_old text,p_new text)
returns void language plpgsql set search_path='' as $$
declare s text:=pg_get_functiondef(p_function);
begin
 if position(p_old in s)=0 then raise exception 'MEASURE_COMMERCIAL_SOURCE_CHANGED: %',p_function; end if;
 execute replace(s,p_old,p_new);
end; $$;
revoke all on function app.patch_commercial_measure(regprocedure,text,text) from public,anon,authenticated,service_role;
select app.patch_commercial_measure('app.assert_pos_draft_items(jsonb)',
 E'or v_quantity <> trunc(v_quantity)\n       or v_quantity not between 1 and 999',
 'or v_quantity <= 0 or v_quantity > 999');
select app.patch_commercial_measure('app.assert_quote_items(jsonb)','v_quantity integer;','v_quantity numeric;');
select app.patch_commercial_measure('app.assert_quote_items(jsonb)',
 $s$v_quantity := (v_item->>'quantity')::integer;$s$,$s$v_quantity := (v_item->>'quantity')::numeric;$s$);
select app.patch_commercial_measure('app.assert_quote_items(jsonb)','or v_quantity not between 1 and 999','or v_quantity <= 0 or v_quantity > 999');
do $$ declare f regprocedure; begin
 select p.oid::regprocedure into strict f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_quote';
 perform app.patch_commercial_measure(f,'v_quantity integer;','v_quantity numeric;');
 perform app.patch_commercial_measure(f,$s$v_quantity := (v_item->>'quantity')::integer;$s$,$s$v_quantity := (v_item->>'quantity')::numeric;$s$);
 perform app.patch_commercial_measure(f,'v_line_total := v_quantity * v_variant.price_cents;','v_line_total := round(v_quantity * v_variant.price_cents)::bigint;');
 select p.oid::regprocedure into strict f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_quote_v2';
 perform app.patch_commercial_measure(f,'v_discount>v_price*v_line.quantity','v_discount>round(v_price*v_line.quantity)::bigint');
 perform app.patch_commercial_measure(f,'line_total_cents=v_price*quantity-v_discount','line_total_cents=round(v_price*quantity)::bigint-v_discount');
 perform app.patch_commercial_measure(f,'v_subtotal:=v_subtotal+v_price*v_line.quantity','v_subtotal:=v_subtotal+round(v_price*v_line.quantity)::bigint');
 select p.oid::regprocedure into strict f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_layaway';
 perform app.patch_commercial_measure(f,E'or v_qty <> trunc(v_qty) then','then');
 select p.oid::regprocedure into strict f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='adjust_layaway_transfer_reservation';
 perform app.patch_commercial_measure(f,'or p_quantity <> trunc(p_quantity)','or not app.valid_measure_quantity(p_variant_id,p_quantity)');
 select p.oid::regprocedure into strict f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='substitute_layaway_item';
 perform app.patch_commercial_measure(f,'v_new_line_total := round(v_item.quantity * v_variant.price_cents)::bigint;',
 $s$if v_product.measure_unit_code is distinct from (select p.measure_unit_code from public.variants v join public.products p on p.id=v.product_id where v.id=v_item.variant_id) then
   raise exception 'LAYAWAY_UNIT_MISMATCH' using errcode='22023';
  end if;
  v_new_line_total := round(v_item.quantity * v_variant.price_cents)::bigint;$s$);
 select p.oid::regprocedure into strict f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='create_return_exchange_base';
 perform app.patch_commercial_measure(f,'or x.quantity <> trunc(x.quantity)','or x.quantity::text in (''NaN'',''Infinity'',''-Infinity'') or x.quantity>999999999.999');
 -- Validate incoming quantities against the ORIGINAL line, including quick
 -- products, before calculating financial allocations or coercing storage.
 perform app.patch_commercial_measure(f,E'  for v_in in\n    select si.id, si.variant_id, si.quantity,',
 $s$  if exists(select 1 from jsonb_to_recordset(p_items_in) x(sale_item_id uuid,quantity numeric)
    join public.sale_items si on si.id=x.sale_item_id
    where (si.variant_id is not null and not app.valid_measure_quantity(si.variant_id,x.quantity))
       or (si.variant_id is null and (x.quantity<>trunc(x.quantity) or x.quantity>999))) then
    raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023';
  end if;
  perform app.assert_measure_items(coalesce(p_items_out,'[]'::jsonb),'quantity');
  for v_in in
    select si.id, si.variant_id, si.quantity,$s$);
 perform app.patch_commercial_measure(f,'sum(v.price_cents * x.quantity)::bigint','sum(round(v.price_cents * x.quantity)::bigint)');
 perform app.patch_commercial_measure(f,'v_line_cents := (v_out.price_cents * v_out.quantity)::bigint;','v_line_cents := round(v_out.price_cents * v_out.quantity)::bigint;');
end; $$;
drop function app.patch_commercial_measure(regprocedure,text,text);
do $$begin
 execute 'create view app.sales_report_lines with (security_invoker=true) as '||current_setting('app.measure_sales_view');
end;$$;
revoke all on app.sales_report_lines from public,anon,authenticated,service_role;
commit;
