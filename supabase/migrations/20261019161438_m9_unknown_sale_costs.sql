begin;

-- A catalog snapshot may have an unknown cost. Never substitute its retail
-- price, a later purchase cost, or zero. Existing snapshots are not rewritten.
alter table public.sale_items alter column unit_cost_cents drop not null;
alter table public.sale_items add constraint sale_item_quick_cost_present
  check (quick_line_id is null or unit_cost_cents is not null);
comment on column public.sale_items.unit_cost_cents is
  'Cost at checkout/delivery. NULL means unknown for catalog lines; never use it as zero for profit. Quick legacy lines use quick_cost_recorded to distinguish unknown from known zero.';

-- Keep the original authorization, classification, unit rounding, filters and
-- pagination. Abort on an unexpected upstream definition instead of weakening it.
do $patch$
declare s text; old_text text; new_text text;
begin
 s:=pg_get_functiondef('public.get_inventory_report_v2(uuid,text,uuid,text)'::regprocedure);
 old_text:='coalesce(sum(round(qty * cost_cents)::bigint), 0) as cost_value_cents,';
 new_text:=$s$case when count(*) filter(where qty<>0 and cost_cents is null)>0 then null
        else coalesce(sum(round(qty * cost_cents)::bigint),0) end as cost_value_cents,
      coalesce(sum(round(qty * cost_cents)::bigint),0) as known_cost_value_cents,
      count(*) filter(where cost_cents is null) as unknown_cost_variant_count,
      count(*) filter(where qty<>0 and cost_cents is null) as unvalued_stock_variant_count,
      count(*) filter(where qty<>0 and cost_cents is null)=0 as cost_valuation_complete,$s$;
 if strpos(s,old_text)=0 then raise exception 'UNKNOWN_COST_REPORT_SOURCE_CHANGED'; end if;
 s:=replace(s,old_text,new_text);
 old_text:='sum(round(qty * cost_cents)::bigint) as cost_value_cents';
 new_text:=$s$case when count(*) filter(where qty<>0 and cost_cents is null)>0 then null
        else coalesce(sum(round(qty * cost_cents)::bigint),0) end as cost_value_cents,
      coalesce(sum(round(qty * cost_cents)::bigint),0) as known_cost_value_cents,
      count(*) filter(where cost_cents is null) as unknown_cost_variant_count,
      count(*) filter(where qty<>0 and cost_cents is null) as unvalued_stock_variant_count,
      count(*) filter(where qty<>0 and cost_cents is null)=0 as cost_valuation_complete$s$;
 if strpos(s,old_text)=0 then raise exception 'UNKNOWN_COST_CATEGORY_SOURCE_CHANGED'; end if;
 s:=replace(s,old_text,new_text);
 execute s;

 -- A real purchase establishes cost when there was no opening balance. With
 -- unknown opening stock the combined cost remains unknown, never an average
 -- that silently assigns a made-up cost to the existing pieces.
 s:=pg_get_functiondef('app.apply_purchase_weighted_cost()'::regprocedure);
 old_text:='v_new_cost:=round((v_old_qty*v_previous_cost+new.quantity*v_unit_cost)/v_global_qty)::bigint;';
 new_text:=$s$if v_old_qty=0 then v_new_cost:=v_unit_cost;
 elsif v_previous_cost is null then v_new_cost:=null;
 else v_new_cost:=round((v_old_qty*v_previous_cost+new.quantity*v_unit_cost)/v_global_qty)::bigint;
 end if;$s$;
 if strpos(s,old_text)=0 then raise exception 'UNKNOWN_COST_PURCHASE_SOURCE_CHANGED'; end if;
 s:=replace(s,old_text,new_text);
 old_text:=$s$'cost_method','WEIGHTED_AVERAGE',$s$;
 new_text:=$s$'cost_method',case when v_new_cost is null then 'UNKNOWN_OPENING_BALANCE'
    when v_old_qty=0 then 'FIRST_RECEIPT' else 'WEIGHTED_AVERAGE' end,$s$;
 if strpos(s,old_text)=0 then raise exception 'UNKNOWN_COST_PURCHASE_METADATA_CHANGED'; end if;
 s:=replace(s,old_text,new_text);
 old_text:=$s$'method','WEIGHTED_AVERAGE'$s$;
 new_text:=$s$'method',case when v_new_cost is null then 'UNKNOWN_OPENING_BALANCE'
    when v_old_qty=0 then 'FIRST_RECEIPT' else 'WEIGHTED_AVERAGE' end$s$;
 if strpos(s,old_text)=0 then raise exception 'UNKNOWN_COST_PURCHASE_AUDIT_CHANGED'; end if;
 execute replace(s,old_text,new_text);
end $patch$;

-- No new privileges, ledger updates, cost backfills, inventory imports or
-- rehearsal-control changes. The existing nonnegative CHECK
-- still rejects negative known costs; SQL CHECK deliberately permits NULL.
commit;
