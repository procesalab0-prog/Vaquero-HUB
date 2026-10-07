begin;

-- Quick lines are sale snapshots, never synthetic variants or barcode identities.
-- Existing catalog lines remain catalog lines; old history is not rewritten.
alter table public.sale_items alter column variant_id drop not null;
alter table public.sale_items alter column sku drop not null;
alter table public.sale_items add column quick_line_id uuid;
alter table public.sale_items add column quick_cost_recorded boolean;
alter table public.sale_items add constraint sale_item_source_complete check (
 (variant_id is not null and sku is not null and quick_line_id is null and quick_cost_recorded is null)
 or (variant_id is null and sku is null and quick_line_id is not null and quick_cost_recorded is not null)
);
create unique index sale_items_quick_line_idx on public.sale_items(sale_id,quick_line_id)
 where quick_line_id is not null;
alter table public.return_items alter column variant_id drop not null;

create function app.assert_quick_pos_item(p_item jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_q jsonb:=p_item->'quick'; v_cost numeric; v_price numeric; v_qty numeric; v_id uuid;
begin
 if app.current_user_id() is null or not app.has_perm('pos.sell') then
  raise exception 'NOT_AUTHORIZED' using errcode='42501';
 end if;
 begin
  v_id:=(p_item->>'variant_id')::uuid;
  v_price:=(v_q->>'unit_price_cents')::numeric;
  v_cost:=(v_q->>'unit_cost_cents')::numeric;
  v_qty:=(p_item->>'quantity')::numeric;
 exception when others then raise exception 'INVALID_QUICK_ITEM' using errcode='22023'; end;
 if jsonb_typeof(v_q) is distinct from 'object' or v_id is null
    or exists(select 1 from public.variants where id=v_id)
    or length(btrim(coalesce(v_q->>'name',''))) not between 1 and 160
    or v_price is null or v_price not between 1 and 100000000
    or v_price<>trunc(v_price) or v_qty is null or v_qty not between 1 and 999 or v_qty<>trunc(v_qty)
    or jsonb_typeof(p_item->'gift_receipt') is distinct from 'boolean'
    or (v_cost is not null and (v_cost not between 0 and 100000000 or v_cost<>trunc(v_cost))) then
  raise exception 'INVALID_QUICK_ITEM' using errcode='22023';
 end if;
 if v_cost is not null and not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id
   where u.id=app.current_user_id() and u.is_active and r.code in ('ADMIN','MANAGER')) then
  raise exception 'QUICK_COST_FORBIDDEN' using errcode='42501';
 end if;
end; $$;
revoke all on function app.assert_quick_pos_item(jsonb) from public,anon,authenticated,service_role;

-- Fail closed if any upstream function differs from the expected migration chain.
-- Preserve the money/authorization engine rather than introduce a second checkout.
create function app.qa_replace_definition(p_source text,p_old text,p_new text) returns text
language plpgsql set search_path='' as $$begin
 if strpos(p_source,p_old)=0 then raise exception 'QUICK_MIGRATION_SOURCE_CHANGED: %',left(p_old,90); end if;
 return replace(p_source,p_old,p_new);
end; $$;
do $patch$
declare s text; f regprocedure;
begin
 s:=pg_get_functiondef('app.create_sale_engine(uuid,uuid,jsonb,jsonb,uuid,jsonb,text,uuid)'::regprocedure);
 s:=app.qa_replace_definition(s,'select v.* into v_variant from public.variants v join public.products p on p.id=v.product_id',
 $new$if v_item ? 'quick' then
      if p_quote_id is not null then raise exception 'QUICK_QUOTE_NOT_ALLOWED' using errcode='22023'; end if;
      perform app.assert_quick_pos_item(v_item);
      v_variant:=null; v_product:=null;
      v_variant.price_cents:=(v_item->'quick'->>'unit_price_cents')::bigint;
      v_variant.cost_cents:=coalesce((v_item->'quick'->>'unit_cost_cents')::bigint,0);
      v_product.name:=btrim(v_item->'quick'->>'name');
    else
    select v.* into v_variant from public.variants v join public.products p on p.id=v.product_id$new$);
 s:=app.qa_replace_definition(s,'select * into v_product from public.products where id=v_variant.product_id;',
 'select * into v_product from public.products where id=v_variant.product_id; end if;');
 s:=app.qa_replace_definition(s,'line_total_cents,gift_receipt)', 'line_total_cents,gift_receipt,quick_line_id,quick_cost_recorded)');
 s:=app.qa_replace_definition(s,$s$coalesce((v_item->>'gift_receipt')::boolean,false)) returning id$s$,
 $s$coalesce((v_item->>'gift_receipt')::boolean,false),case when v_item ? 'quick' then (v_item->>'variant_id')::uuid end,case when v_item ? 'quick' then v_item->'quick'->>'unit_cost_cents' is not null end) returning id$s$);
 s:=app.qa_replace_definition(s,$s$from jsonb_array_elements(p_items) i order by i->>'variant_id';$s$,
 $s$from jsonb_array_elements(p_items) i where not (i ? 'quick') order by i->>'variant_id';$s$);
 s:=app.qa_replace_definition(s,$s$for v_item in select value from jsonb_array_elements(p_items) order by value->>'variant_id' loop$s$,
 $s$for v_item in select value from jsonb_array_elements(p_items) where not (value ? 'quick') order by value->>'variant_id' loop$s$);
 execute s;

 s:=pg_get_functiondef('app.assert_pos_draft_items(jsonb)'::regprocedure);
 s:=app.qa_replace_definition(s,$s$if jsonb_typeof(v_item) <> 'object'$s$, $s$if v_item ? 'quick' then perform app.assert_quick_pos_item(v_item); continue; end if;
    if jsonb_typeof(v_item) <> 'object'$s$);
 execute s;
 s:=pg_get_functiondef('public.resume_pos_draft(uuid)'::regprocedure);
 s:=app.qa_replace_definition(s,'where v.id is null or not v.is_active or p.id is null or not p.is_active',
 $s$where not (item ? 'quick') and (v.id is null or not v.is_active or p.id is null or not p.is_active)$s$);
 -- Recheck authorization and quick snapshots on resume as on save and checkout.
 s:=app.qa_replace_definition(s,$s$if exists (
    select 1
    from jsonb_array_elements(v_draft.items) item$s$, $s$perform app.assert_pos_draft_items(v_draft.items);
  if exists (
    select 1
    from jsonb_array_elements(v_draft.items) item$s$);
 execute s;
 s:=pg_get_functiondef('app.cancel_sale_base(uuid,text)'::regprocedure);
 s:=app.qa_replace_definition(s,'where i.sale_id = v_sale.id','where i.sale_id = v_sale.id and i.variant_id is not null');
 execute s;
 s:=pg_get_functiondef('app.create_return_exchange_base(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,text)'::regprocedure);
 s:=app.qa_replace_definition(s,$s$perform app.apply_movement(v_in.variant_id, v_session.location_id, 'RETURN'$s$,
 $s$if v_in.variant_id is not null then
    perform app.apply_movement(v_in.variant_id, v_session.location_id, 'RETURN'$s$);
 s:=app.qa_replace_definition(s,$s$  end loop;
  for v_out in$s$, $s$    end if; -- no inventory for quick sale snapshots
  end loop;
  for v_out in$s$);
 execute s;
 s:=pg_get_functiondef('public.search_equal_exchange_variants(bigint,uuid,text,integer)'::regprocedure);
 s:=app.qa_replace_definition(s,'or p_exclude_variant_id is null','or false -- quick sale lines have no catalog variant');
 s:=app.qa_replace_definition(s,'v.id <> p_exclude_variant_id','(p_exclude_variant_id is null or v.id <> p_exclude_variant_id)');
 execute s;
 -- JSON APIs keep a string for display/PDF callers, but no barcode is minted.
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('get_sale_receipt','list_sale_tickets','get_sale_ticket_by_folio','get_my_customer_tickets','get_returnable_sale')
 loop
  s:=pg_get_functiondef(f);
  s:=replace(s,$s$'sku',i.sku$s$,$s$'sku',coalesce(i.sku,'')$s$);
  s:=replace(s,$s$'sku', i.sku$s$,$s$'sku', coalesce(i.sku,'')$s$);
  s:=replace(s,$s$'sku',si.sku$s$,$s$'sku',coalesce(si.sku,'')$s$);
  s:=replace(s,$s$'sku', si.sku$s$,$s$'sku', coalesce(si.sku,'')$s$);
  execute s;
 end loop;
end; $patch$;
drop function app.qa_replace_definition(text,text,text);

-- Even privileged inserts cannot attach a quick return to a catalog variant.
create function app.guard_return_item_source() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.direction='OUT' and new.variant_id is null)
    or (new.direction='IN' and not exists(select 1 from public.sale_items i
       where i.id=new.sale_item_id and i.variant_id is not distinct from new.variant_id)) then
  raise exception 'RETURN_ITEM_SOURCE_MISMATCH' using errcode='23514';
 end if;
 return new;
end; $$;
create trigger return_items_source_guard before insert on public.return_items
 for each row execute function app.guard_return_item_source();
revoke all on function app.guard_return_item_source() from public,anon,authenticated,service_role;

-- Recoverable commercial snapshots; no costs disclosed, no editing historical sales.
create function public.list_quick_sale_items(p_location_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if app.current_user_id() is null or not app.has_perm('products.create')
    or not app.can_access_location(p_location_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_result from (
  select i.id,s.folio,s.sold_at,s.status,i.product_name,i.quantity,i.unit_price_cents
  from public.sale_items i join public.sales s on s.id=i.sale_id
  where i.quick_line_id is not null and s.location_id=p_location_id
  order by s.sold_at desc,i.line_number limit greatest(1,least(coalesce(p_limit,100),200))
 ) x;
 return v_result;
end; $$;
revoke all on function public.list_quick_sale_items(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_quick_sale_items(uuid,integer) to authenticated;
commit;
