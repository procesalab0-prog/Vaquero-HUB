begin;
-- Local, unpublished foundation. Fractional checkout/receiving stays blocked until all
-- quantity paths and historical constraints are upgraded together.
create table public.measure_units (
 code text primary key check(code ~ '^[A-Z][A-Z0-9_]{0,11}$'),
 name text not null check(name=btrim(name) and length(name) between 1 and 60),
 decimal_places smallint not null check(decimal_places in (0,3)),
 created_by uuid references public.app_users(id),
 created_at timestamptz not null default now()
);
insert into public.measure_units(code,name,decimal_places) values
 ('PIECE','Pieza',0),('PAIR','Par',0),('KILO','Kilo',3),('METRE','Metro',3);
alter table public.measure_units enable row level security;
revoke all on public.measure_units from public,anon,authenticated,service_role;
alter table public.products add column measure_unit_code text not null default 'PIECE' references public.measure_units(code);

create function app.guard_measure_unit_definition() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'UNIT_DEFINITION_IMMUTABLE' using errcode='42501';
end;
$$;
create trigger measure_unit_definition_immutable before update or delete on public.measure_units
 for each row execute function app.guard_measure_unit_definition();

create function public.list_measure_units() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if app.current_user_id() is null or not(app.has_perm('products.read') or app.has_perm('products.create') or app.has_perm('products.update') or app.has_perm('pos.sell') or app.has_perm('inventory.read')) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'decimal_places',decimal_places) order by name),'[]'::jsonb) from public.measure_units);
end;
$$;
create function public.create_measure_unit(p_code text,p_name text,p_decimal_places integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app.current_user_id(); v_unit public.measure_units; v_code text:=upper(btrim(p_code)); v_name text:=btrim(p_name);
begin
 if v_actor is null or not app.has_perm('products.create') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if v_code is null or v_code !~ '^[A-Z][A-Z0-9_]{0,11}$' or v_name is null or length(v_name) not between 1 and 60 or p_decimal_places is null or p_decimal_places not in (0,3) then
  raise exception 'INVALID_MEASURE_UNIT' using errcode='22023'; end if;
 begin
  insert into public.measure_units(code,name,decimal_places,created_by) values(v_code,v_name,p_decimal_places,v_actor) returning * into v_unit;
 exception when unique_violation then raise exception 'MEASURE_UNIT_CODE_TAKEN' using errcode='22023'; end;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,after_data)
 values(v_actor,'measure_unit.created','measure_units',v_code,to_jsonb(v_unit));
 return to_jsonb(v_unit);
end;
$$;
-- Quantity validation shared by subsequent flow migrations. No conversion:
-- 1 pair remains 1 pair, never silently becomes 2 pieces.
create function app.valid_measure_quantity(p_variant_id uuid,p_quantity numeric) returns boolean
 language sql stable security definer set search_path='' as $$
 select coalesce((select p_quantity is not null and p_quantity::text not in ('NaN','Infinity','-Infinity')
   and p_quantity=round(p_quantity,u.decimal_places)
 from public.variants v join public.products p on p.id=v.product_id
 join public.measure_units u on u.code=p.measure_unit_code where v.id=p_variant_id),false);
$$;
revoke all on function app.guard_measure_unit_definition(),app.valid_measure_quantity(uuid,numeric) from public,anon,authenticated,service_role;
revoke all on function public.list_measure_units(),public.create_measure_unit(text,text,integer) from public,anon,service_role;
grant execute on function public.list_measure_units(),public.create_measure_unit(text,text,integer) to authenticated;
commit;
