begin;

-- Las plantillas son datos operativos editables. No aceptan HTML ni CSS:
-- el acomodo se limita a tres composiciones conocidas y a campos explícitos.
create table public.label_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  width_mm numeric(6,2) not null check (width_mm between 20 and 120),
  height_mm numeric(6,2) not null check (height_mm between 15 and 100),
  layout text not null default 'BALANCED'
    check (layout in ('BALANCED', 'PRODUCT_FOCUS', 'PRICE_FOCUS')),
  show_logo boolean not null default true,
  show_product_name boolean not null default true,
  show_brand boolean not null default false,
  show_size boolean not null default true,
  show_color boolean not null default true,
  show_price boolean not null default true,
  show_sku boolean not null default false,
  show_barcode boolean not null default true,
  show_code boolean not null default true,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (show_barcode or show_code)
);

create unique index label_templates_name_key
  on public.label_templates (lower(btrim(name)));
create unique index label_templates_one_default_key
  on public.label_templates (is_default)
  where is_default and is_active;

create trigger label_templates_touch_updated_at
before update on public.label_templates
for each row execute function app.touch_updated_at();

create trigger label_templates_audit
after insert or update on public.label_templates
for each row execute function app.audit_row_change();

alter table public.label_templates enable row level security;

create policy label_templates_select on public.label_templates
for select to authenticated
using ((select app.has_perm('products.read')));

revoke all on public.label_templates from public, anon, authenticated;
grant select on public.label_templates to authenticated;
grant select, insert, update, delete on public.label_templates to service_role;

insert into public.label_templates (
  name, width_mm, height_mm, layout, is_default
) values (
  'Vaquero 50 × 30 mm', 50, 30, 'BALANCED', true
);

create or replace function public.bulk_update_variant_status(
  p_variant_ids uuid[],
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_requested integer;
  v_changed integer;
begin
  if v_actor is null or not (select app.has_perm('products.update')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_variant_ids is null or p_is_active is null then
    raise exception 'INVALID_BATCH' using errcode = '22023';
  end if;

  v_requested := cardinality(p_variant_ids);
  if v_requested < 1 or v_requested > 500
     or (select count(distinct id) from unnest(p_variant_ids) as ids(id)) <> v_requested then
    raise exception 'INVALID_BATCH' using errcode = '22023';
  end if;

  -- Bloquear en orden estable hace que dos lotes superpuestos no se intercalen.
  perform 1
  from public.variants
  where id = any(p_variant_ids)
  order by id
  for update;
  if (select count(*) from public.variants where id = any(p_variant_ids)) <> v_requested then
    raise exception 'VARIANT_NOT_FOUND' using errcode = '22023';
  end if;

  update public.variants
  set is_active = p_is_active,
      updated_by = v_actor
  where id = any(p_variant_ids)
    and is_active is distinct from p_is_active;
  get diagnostics v_changed = row_count;

  return jsonb_build_object(
    'requested_count', v_requested,
    'changed_count', v_changed,
    'is_active', p_is_active
  );
end;
$$;

create or replace function public.bulk_update_variant_prices(
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_requested integer;
  v_changed integer;
begin
  if v_actor is null or not (select app.has_perm('products.price_update')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'INVALID_PRICE_BATCH' using errcode = '22023';
  end if;

  v_requested := jsonb_array_length(p_changes);
  if v_requested < 1 or v_requested > 500
     or exists (
       select 1
       from jsonb_array_elements(p_changes) item
       cross join lateral jsonb_object_keys(item) key
       where key not in ('variant_id', 'expected_price_cents', 'new_price_cents')
     ) then
    raise exception 'INVALID_PRICE_BATCH' using errcode = '22023';
  end if;

  create temporary table price_batch_input (
    variant_id uuid primary key,
    expected_price_cents bigint not null check (expected_price_cents >= 0),
    new_price_cents bigint not null check (new_price_cents >= 0)
  ) on commit drop;

  begin
    insert into price_batch_input (variant_id, expected_price_cents, new_price_cents)
    select variant_id, expected_price_cents, new_price_cents
    from jsonb_to_recordset(p_changes) as x(
      variant_id uuid,
      expected_price_cents bigint,
      new_price_cents bigint
    );
  exception
    when others then
      raise exception 'INVALID_PRICE_BATCH' using errcode = '22023';
  end;

  if (select count(*) from price_batch_input) <> v_requested
     or exists (
       select 1 from price_batch_input
       where expected_price_cents = new_price_cents
     ) then
    raise exception 'INVALID_PRICE_BATCH' using errcode = '22023';
  end if;

  perform 1
  from public.variants v
  join price_batch_input i on i.variant_id = v.id
  order by v.id
  for update of v;
  if (select count(*) from public.variants v join price_batch_input i on i.variant_id = v.id) <> v_requested then
    raise exception 'VARIANT_NOT_FOUND' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.variants v
    join price_batch_input i on i.variant_id = v.id
    where v.price_cents <> i.expected_price_cents
  ) then
    raise exception 'STALE_PRICE_BATCH' using errcode = '40001';
  end if;

  update public.variants v
  set price_cents = i.new_price_cents,
      updated_by = v_actor
  from price_batch_input i
  where v.id = i.variant_id;
  get diagnostics v_changed = row_count;

  return jsonb_build_object(
    'requested_count', v_requested,
    'changed_count', v_changed
  );
end;
$$;

create or replace function public.save_label_template(
  p_id uuid,
  p_name text,
  p_width_mm numeric,
  p_height_mm numeric,
  p_layout text,
  p_show_logo boolean,
  p_show_product_name boolean,
  p_show_brand boolean,
  p_show_size boolean,
  p_show_color boolean,
  p_show_price boolean,
  p_show_sku boolean,
  p_show_barcode boolean,
  p_show_code boolean,
  p_is_default boolean,
  p_is_active boolean
)
returns public.label_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_id uuid := p_id;
  v_result public.label_templates;
begin
  if v_actor is null or not (select app.has_perm('products.update')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null
     or length(btrim(p_name)) > 80
     or p_width_mm not between 20 and 120
     or p_height_mm not between 15 and 100
     or p_layout not in ('BALANCED', 'PRODUCT_FOCUS', 'PRICE_FOCUS')
     or p_show_logo is null or p_show_product_name is null
     or p_show_brand is null or p_show_size is null or p_show_color is null
     or p_show_price is null or p_show_sku is null or p_show_barcode is null
     or p_show_code is null or p_is_default is null or p_is_active is null
     or not (p_show_barcode or p_show_code)
     or (p_is_default and not p_is_active) then
    raise exception 'INVALID_LABEL_TEMPLATE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('label_templates_default', 0));

  if p_is_default then
    update public.label_templates
    set is_default = false, updated_by = v_actor
    where is_default and (v_id is null or id <> v_id);
  end if;

  if v_id is null then
    insert into public.label_templates (
      name, width_mm, height_mm, layout, show_logo, show_product_name,
      show_brand, show_size, show_color, show_price, show_sku, show_barcode,
      show_code, is_default, is_active, created_by, updated_by
    ) values (
      btrim(p_name), p_width_mm, p_height_mm, p_layout, p_show_logo,
      p_show_product_name, p_show_brand, p_show_size, p_show_color,
      p_show_price, p_show_sku, p_show_barcode, p_show_code,
      p_is_default, p_is_active, v_actor, v_actor
    ) returning * into v_result;
  else
    update public.label_templates
    set name = btrim(p_name), width_mm = p_width_mm, height_mm = p_height_mm,
        layout = p_layout, show_logo = p_show_logo,
        show_product_name = p_show_product_name, show_brand = p_show_brand,
        show_size = p_show_size, show_color = p_show_color,
        show_price = p_show_price, show_sku = p_show_sku,
        show_barcode = p_show_barcode, show_code = p_show_code,
        is_default = p_is_default, is_active = p_is_active,
        updated_by = v_actor
    where id = v_id
    returning * into v_result;
    if not found then
      raise exception 'LABEL_TEMPLATE_NOT_FOUND' using errcode = '22023';
    end if;
  end if;

  if not exists (select 1 from public.label_templates where is_active) then
    raise exception 'INVALID_LABEL_TEMPLATE' using errcode = '22023';
  end if;

  -- Siempre debe quedar una plantilla activa por defecto.
  if not exists (
    select 1 from public.label_templates where is_default and is_active
  ) then
    update public.label_templates
    set is_default = true, updated_by = v_actor
    where id = (
      select id from public.label_templates
      where is_active
      order by created_at, id
      limit 1
    );
  end if;

  select * into v_result from public.label_templates where id = v_result.id;
  return v_result;
exception
  when unique_violation then
    raise exception 'LABEL_TEMPLATE_DUPLICATE' using errcode = '23505';
end;
$$;

comment on table public.label_templates is
  'Plantillas controladas de etiquetas; editables sin admitir HTML o CSS arbitrario.';
comment on function public.bulk_update_variant_status(uuid[], boolean) is
  'Activa o desactiva hasta 500 variantes bajo candado y con auditoría por renglón.';
comment on function public.bulk_update_variant_prices(jsonb) is
  'Cambia hasta 500 precios sólo si coinciden con la vista previa; auditoría por variante.';
comment on function public.save_label_template(uuid, text, numeric, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) is
  'Crea o edita plantillas de etiqueta con productos.update y un único diseño predeterminado.';

revoke execute on function public.bulk_update_variant_status(uuid[], boolean)
  from public, anon;
revoke execute on function public.bulk_update_variant_prices(jsonb)
  from public, anon;
revoke execute on function public.save_label_template(uuid, text, numeric, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean)
  from public, anon;

grant execute on function public.bulk_update_variant_status(uuid[], boolean)
  to authenticated;
grant execute on function public.bulk_update_variant_prices(jsonb)
  to authenticated;
grant execute on function public.save_label_template(uuid, text, numeric, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean)
  to authenticated;

commit;
