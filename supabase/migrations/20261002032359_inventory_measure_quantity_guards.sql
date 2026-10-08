begin;
-- Every unit keeps its own precision. Existing historical fractional movements
-- stay untouched: triggers validate new writes, not the old immutable ledger.
-- This does NOT remove products_measure_unit_guard's fractional assignment gate.
-- Rebuild only this closed internal view, preserving its current query and
-- invoker semantics. Never CASCADE: unexpected dependencies abort atomically.
select set_config('app.measure_inventory_view',pg_get_viewdef('app.inventory_report_lines'::regclass,true),true);
drop view app.inventory_report_lines;
alter table public.inventory_by_location
 drop constraint inventory_piece_quantities_integer,
 alter column qty type numeric, alter column reserved_qty type numeric;
alter table public.inventory_movements
 drop constraint inventory_movement_piece_quantities_integer,
 alter column quantity type numeric, alter column previous_qty type numeric,
 alter column new_qty type numeric;
alter table public.inventory_count_items
 drop constraint inventory_count_piece_quantities_integer,
 alter column counted_qty type numeric, alter column system_qty type numeric,
 alter column difference type numeric;
alter table public.transfer_items
 drop constraint transfer_piece_quantities_integer,
 alter column qty_requested type numeric, alter column qty_sent type numeric,
 alter column qty_received type numeric;

-- The former numeric(12,3) bound remains, without pre-trigger rounding. Original
-- signs, balance equality, reserved <= qty and document bounds remain intact.
alter table public.inventory_by_location add constraint inventory_measure_range
 check (abs(qty)<=999999999.999 and abs(reserved_qty)<=999999999.999) not valid;
alter table public.inventory_movements add constraint movement_measure_range
 check (abs(quantity)<=999999999.999 and abs(previous_qty)<=999999999.999 and abs(new_qty)<=999999999.999) not valid;
alter table public.inventory_count_items add constraint count_measure_range
 check (abs(counted_qty)<=999999999.999 and (system_qty is null or abs(system_qty)<=999999999.999)
   and (difference is null or abs(difference)<=999999999.999)) not valid;
alter table public.transfer_items add constraint transfer_measure_range
 check (abs(qty_requested)<=999999999.999 and (qty_sent is null or abs(qty_sent)<=999999999.999)
   and (qty_received is null or abs(qty_received)<=999999999.999)) not valid;

create function app.guard_inventory_measure_quantity() returns trigger
language plpgsql security definer set search_path='' as $$
declare fields text[]; field text; row_data jsonb:=to_jsonb(new); q numeric;
begin
 fields:=case tg_table_name
  when 'inventory_by_location' then array['qty','reserved_qty']
  when 'inventory_movements' then array['quantity','previous_qty','new_qty']
  when 'inventory_count_items' then array['counted_qty','system_qty','difference']
  when 'transfer_items' then array['qty_requested','qty_sent','qty_received']
  else null end;
 if fields is null then raise exception 'INVALID_MEASURE_TABLE' using errcode='23514'; end if;
 foreach field in array fields loop
  if row_data->>field is null then continue; end if;
  q:=(row_data->>field)::numeric;
  if not app.valid_measure_quantity(new.variant_id,q) then
   raise exception 'INVALID_MEASURE_QUANTITY' using errcode='23514'; end if;
 end loop;
 return new;
end;
$$;
revoke all on function app.guard_inventory_measure_quantity() from public,anon,authenticated,service_role;
create trigger inventory_measure_quantity before insert or update on public.inventory_by_location
 for each row execute function app.guard_inventory_measure_quantity();
create trigger movement_measure_quantity before insert or update on public.inventory_movements
 for each row execute function app.guard_inventory_measure_quantity();
create trigger count_measure_quantity before insert or update on public.inventory_count_items
 for each row execute function app.guard_inventory_measure_quantity();
create trigger transfer_measure_quantity before insert or update on public.transfer_items
 for each row execute function app.guard_inventory_measure_quantity();
do $$begin
 execute 'create view app.inventory_report_lines with (security_invoker=true) as '||current_setting('app.measure_inventory_view');
end;$$;
revoke all on app.inventory_report_lines from public,anon,authenticated,service_role;
commit;
