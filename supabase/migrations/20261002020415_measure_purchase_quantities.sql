begin;
-- Forward-only purchase groundwork. Product assignment still rejects fractional
-- units until sale, quote, reservation and return flows are upgraded together.
alter table public.purchase_items alter column ordered_qty type numeric,
 alter column received_qty type numeric;
alter table public.receipt_items alter column received_qty type numeric;

create function app.guard_purchase_measure_quantity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='purchase_items' then
  if not app.valid_measure_quantity(new.variant_id,new.ordered_qty)
     or not app.valid_measure_quantity(new.variant_id,new.received_qty) then
   raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023'; end if;
 else
  if not app.valid_measure_quantity(new.variant_id,new.received_qty) then
   raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023'; end if;
 end if;
 return new;
end;
$$;
create trigger purchase_measure_quantity before insert or update on public.purchase_items
 for each row execute function app.guard_purchase_measure_quantity();
create trigger receipt_measure_quantity before insert or update on public.receipt_items
 for each row execute function app.guard_purchase_measure_quantity();
revoke all on function app.guard_purchase_measure_quantity() from public,anon,authenticated,service_role;

-- Exact substitutions fail the entire migration if upstream SQL changed. Never
-- replace a public function with a weaker independently maintained copy.
create function app.purchase_definition_replace(p_source text,p_before text,p_after text)
returns text language plpgsql set search_path='' as $$
begin
 if position(p_before in p_source)=0 then raise exception 'PURCHASE_UPSTREAM_CHANGED: %',p_before; end if;
 return replace(p_source,p_before,p_after);
end;
$$;
revoke all on function app.purchase_definition_replace(text,text,text) from public,anon,authenticated,service_role;
do $$
declare d text;
begin
 d:=pg_get_functiondef('public.create_purchase_order(uuid,uuid,jsonb,date,text)'::regprocedure);
 d:=app.purchase_definition_replace(d,$s$or coalesce(v_item->>'qty', '') !~ '^[1-9][0-9]*$'$s$,
  $s$or coalesce(v_item->>'qty', '') !~ '^[0-9]+(\.[0-9]{1,3})?$'$s$);
 d:=app.purchase_definition_replace(d,$s$or (v_item->>'qty')::numeric > 999999999$s$,
  $s$or (v_item->>'qty')::numeric <= 0 or (v_item->>'qty')::numeric > 999999999$s$);
 d:=app.purchase_definition_replace(d,$s$    insert into public.purchase_items(purchase_order_id, variant_id, ordered_qty, unit_cost_cents)$s$,
  $s$    if not app.valid_measure_quantity((v_item->>'variant_id')::uuid,(v_item->>'qty')::numeric) then
      raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023'; end if;
    insert into public.purchase_items(purchase_order_id, variant_id, ordered_qty, unit_cost_cents)$s$);
 d:=app.purchase_definition_replace(d,$s$(v_item->>'qty')::integer$s$,$s$(v_item->>'qty')::numeric$s$);
 execute d;

 d:=pg_get_functiondef('public.receive_purchase_order(uuid,jsonb,uuid,text)'::regprocedure);
 d:=app.purchase_definition_replace(d,'v_qty integer;','v_qty numeric;');
 d:=app.purchase_definition_replace(d,$s$or coalesce(v_item->>'qty', '') !~ '^[1-9][0-9]*$'$s$,
  $s$or coalesce(v_item->>'qty', '') !~ '^[0-9]+(\.[0-9]{1,3})?$'$s$);
 d:=app.purchase_definition_replace(d,$s$(v_item->>'qty')::integer$s$,$s$(v_item->>'qty')::numeric$s$);
 d:=app.purchase_definition_replace(d,$s$    if v_line.received_qty + v_qty > v_line.ordered_qty then$s$,
  $s$    if v_qty<=0 or v_qty>999999999 or not app.valid_measure_quantity(v_line.variant_id,v_qty) then
      raise exception 'INVALID_MEASURE_QUANTITY' using errcode='22023'; end if;
    if v_line.received_qty + v_qty > v_line.ordered_qty then$s$);
 execute d;

 d:=pg_get_functiondef('public.list_purchase_orders(uuid,integer)'::regprocedure);
 d:=app.purchase_definition_replace(d,'public.list_purchase_orders(','public.list_purchase_orders_v2(');
 d:=app.purchase_definition_replace(d,'ordered_qty bigint, received_qty bigint','ordered_qty numeric, received_qty numeric');
 d:=app.purchase_definition_replace(d,'sum(pi.ordered_qty)::bigint,sum(pi.received_qty)::bigint,',
  'sum(pi.ordered_qty)::numeric,sum(pi.received_qty)::numeric,');
 d:=app.purchase_definition_replace(d,'sum(pi.ordered_qty::numeric*pi.unit_cost_cents)::numeric,',
  'sum(round(pi.ordered_qty*pi.unit_cost_cents))::numeric,');
 d:=app.purchase_definition_replace(d,$s$'unit_cost_cents',pi.unit_cost_cents)$s$,
  $s$'unit_cost_cents',pi.unit_cost_cents,'measure_unit_code',p.measure_unit_code)$s$);
 execute d;

 -- Legacy integer API must not silently round a fractional order. Integer-only
 -- consumers retain their original contract; the application uses v2 below.
 d:=pg_get_functiondef('public.list_purchase_orders(uuid,integer)'::regprocedure);
 d:=app.purchase_definition_replace(d,'  return query select po.id,',
  $s$  if exists(select 1 from public.purchase_items i join public.purchase_orders o on o.id=i.purchase_order_id
    where o.location_id=p_location_id and (i.ordered_qty<>trunc(i.ordered_qty) or i.received_qty<>trunc(i.received_qty))) then
    raise exception 'FRACTIONAL_PURCHASE_REQUIRES_V2' using errcode='22023'; end if;
  return query select po.id,$s$);
 execute d;
end;
$$;
drop function app.purchase_definition_replace(text,text,text);
revoke all on function public.list_purchase_orders_v2(uuid,integer) from public,anon,service_role;
grant execute on function public.list_purchase_orders_v2(uuid,integer) to authenticated;
commit;
