begin;
-- Cost is global per variant, so its weight includes every physical balance,
-- including reserved, inactive-location stock and merchandise in transit.
-- This forward-only migration never rewrites sale costs or old receipts.
create function app.lock_inventory_cost_basis() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='UPDATE' and new.qty is distinct from old.qty)
    or (tg_op='INSERT' and new.qty<>0) or (tg_op='DELETE' and old.qty<>0) then
  perform 1 from public.variants where id=case when tg_op='DELETE' then old.variant_id else new.variant_id end for update;
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger inventory_cost_basis_lock before insert or update or delete on public.inventory_by_location
 for each row execute function app.lock_inventory_cost_basis();

create function app.apply_purchase_weighted_cost() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_previous_cost bigint; v_unit_cost bigint; v_global_qty numeric; v_old_qty numeric;
 v_new_cost bigint; v_order_id uuid; v_receipt_id uuid; v_purchase_item_id uuid;
begin
 if new.movement_type<>'PURCHASE' or new.reference_type<>'PURCHASE_RECEIPT' then return new; end if;
 if new.quantity<=0 or coalesce(new.metadata->>'purchase_item_id','') !~ '^[0-9a-f-]{36}$'
    or new.reference_id !~ '^[0-9a-f-]{36}$' then raise exception 'INVALID_PURCHASE_COST_SOURCE' using errcode='22023'; end if;
 v_receipt_id:=new.reference_id::uuid; v_purchase_item_id:=(new.metadata->>'purchase_item_id')::uuid;
 select pi.unit_cost_cents,pi.purchase_order_id into v_unit_cost,v_order_id
 from public.purchase_items pi join public.receipts r on r.purchase_order_id=pi.purchase_order_id
 where pi.id=v_purchase_item_id and pi.variant_id=new.variant_id and r.id=v_receipt_id and r.location_id=new.location_id;
 if not found or v_unit_cost<0 or new.metadata->>'unit_cost_cents' is distinct from v_unit_cost::text then
  raise exception 'INVALID_PURCHASE_COST_SOURCE' using errcode='22023'; end if;
 select cost_cents into strict v_previous_cost from public.variants where id=new.variant_id for update;
 -- Balance update already ran and retains the variant lock until commit.
 select coalesce(sum(qty),0) into v_global_qty from public.inventory_by_location where variant_id=new.variant_id;
 v_old_qty:=v_global_qty-new.quantity;
 if v_old_qty<0 or v_global_qty<=0 then raise exception 'INVALID_PURCHASE_COST_BALANCE' using errcode='23514'; end if;
 v_new_cost:=round((v_old_qty*v_previous_cost+new.quantity*v_unit_cost)/v_global_qty)::bigint;
 update public.variants set cost_cents=v_new_cost where id=new.variant_id;
 new.metadata:=new.metadata||jsonb_build_object('cost_method','WEIGHTED_AVERAGE',
  'previous_cost_cents',v_previous_cost,'new_cost_cents',v_new_cost,'global_qty_before',v_old_qty);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,before_data,after_data,metadata)
 values(new.user_id,'purchase.weighted_cost_applied','variants',new.variant_id::text,new.location_id,
  jsonb_build_object('cost_cents',v_previous_cost,'global_qty',v_old_qty),
  jsonb_build_object('cost_cents',v_new_cost,'global_qty',v_global_qty),
  jsonb_build_object('receipt_id',v_receipt_id,'purchase_order_id',v_order_id,'purchase_item_id',v_purchase_item_id,
   'received_qty',new.quantity,'purchase_unit_cost_cents',v_unit_cost,'method','WEIGHTED_AVERAGE'));
 return new;
end;
$$;
create trigger inventory_purchase_weighted_cost before insert on public.inventory_movements
 for each row execute function app.apply_purchase_weighted_cost();
revoke all on function app.lock_inventory_cost_basis(),app.apply_purchase_weighted_cost()
 from public,anon,authenticated,service_role;
commit;
