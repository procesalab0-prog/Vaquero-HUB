begin;
-- No implicit conversion. Fractional units are defined but remain gated until
-- all checkout, purchasing, return and reservation flows support their precision.
create function app.guard_product_measure_unit() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_decimals integer;
begin
 if tg_op='UPDATE' and new.measure_unit_code=old.measure_unit_code then return new; end if;
 select decimal_places into v_decimals from public.measure_units where code=new.measure_unit_code;
 if not found then raise exception 'INVALID_MEASURE_UNIT' using errcode='22023'; end if;
 if v_decimals<>0 then raise exception 'UNIT_FRACTIONAL_FLOW_PENDING' using errcode='22023'; end if;
 if tg_op='INSERT' then return new; end if;
 perform id from public.variants where product_id=old.id order by id for update;
 if exists(select 1 from public.variants v where v.product_id=old.id and (
    exists(select 1 from public.inventory_by_location i where i.variant_id=v.id and (i.qty<>0 or i.reserved_qty<>0))
    or exists(select 1 from public.inventory_movements m where m.variant_id=v.id)
    or exists(select 1 from public.inventory_reservation_movements m where m.variant_id=v.id)
    or exists(select 1 from public.sale_items i where i.variant_id=v.id)
    or exists(select 1 from public.inventory_count_items i where i.variant_id=v.id)
    or exists(select 1 from public.transfer_items i where i.variant_id=v.id)
    or exists(select 1 from public.purchase_items i where i.variant_id=v.id)
    or exists(select 1 from public.quote_items i where i.variant_id=v.id)
    or exists(select 1 from public.layaway_items i where i.variant_id=v.id)
    or exists(select 1 from public.pos_drafts d, jsonb_array_elements(d.items) i where i->>'variant_id'=v.id::text)
 )) then raise exception 'PRODUCT_UNIT_HAS_HISTORY' using errcode='22023'; end if;
 return new;
end;
$$;
create trigger products_measure_unit_guard before insert or update of measure_unit_code on public.products
 for each row execute function app.guard_product_measure_unit();

create function public.set_product_measure_unit(p_product_id uuid,p_unit_code text,p_expected_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app.current_user_id(); v_product public.products;
begin
 if v_actor is null or not app.has_perm('products.update') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_product from public.products where id=p_product_id for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='22023'; end if;
 if p_expected_code is null or p_expected_code is distinct from v_product.measure_unit_code then
  raise exception 'STALE_PRODUCT_UNIT' using errcode='22023'; end if;
 if p_unit_code=v_product.measure_unit_code then return jsonb_build_object('code',p_unit_code); end if;
 update public.products set measure_unit_code=p_unit_code,updated_by=v_actor where id=p_product_id;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,before_data,after_data)
 values(v_actor,'product.measure_unit_changed','products',p_product_id::text,
  jsonb_build_object('measure_unit_code',v_product.measure_unit_code),jsonb_build_object('measure_unit_code',p_unit_code));
 return jsonb_build_object('code',p_unit_code);
end;
$$;
revoke all on function app.guard_product_measure_unit() from public,anon,authenticated,service_role;
revoke all on function public.set_product_measure_unit(uuid,text,text) from public,anon,service_role;
grant execute on function public.set_product_measure_unit(uuid,text,text) to authenticated;
commit;
