begin;

create table public.brands (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index brands_name_unique_idx on public.brands (lower(btrim(name)));

create table public.size_scales (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null unique check (btrim(name) <> '')
);

create table public.categories (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  default_size_scale_code text references public.size_scales(code),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_name_unique_idx on public.categories (lower(btrim(name)));

create table public.attribute_types (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null unique check (btrim(name) <> ''),
  display_order integer not null default 0
);

create table public.attribute_values (
  id uuid primary key default extensions.gen_random_uuid(),
  type_code text not null references public.attribute_types(code),
  scale_code text references public.size_scales(code),
  value text not null check (btrim(value) <> ''),
  display_order numeric not null default 0,
  unique nulls not distinct (type_code, scale_code, value)
);
create index attribute_values_order_idx
  on public.attribute_values (type_code, scale_code, display_order, value);

create table public.products (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  search_name text generated always as (
    lower(translate(name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
  ) stored,
  brand_id uuid references public.brands(id),
  category_id uuid not null references public.categories(id),
  description text,
  is_active boolean not null default true,
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_search_name_idx on public.products (search_name);
create index products_brand_id_idx on public.products (brand_id);
create index products_category_id_idx on public.products (category_id);

create table public.variants (
  id uuid primary key default extensions.gen_random_uuid(),
  product_id uuid not null references public.products(id),
  sku text not null unique check (btrim(sku) <> ''),
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  price_cents bigint not null default 0 check (price_cents >= 0),
  legacy_sicar_code text unique,
  woocommerce_product_id bigint,
  woocommerce_variation_id bigint unique,
  is_active boolean not null default true,
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index variants_product_id_idx on public.variants (product_id);
create index variants_active_product_idx on public.variants (product_id) where is_active;

create table public.variant_attributes (
  variant_id uuid not null references public.variants(id) on delete cascade,
  type_code text not null references public.attribute_types(code),
  value_id uuid not null references public.attribute_values(id),
  primary key (variant_id, type_code)
);
create index variant_attributes_value_id_idx on public.variant_attributes (value_id);

create table public.barcodes (
  id uuid primary key default extensions.gen_random_uuid(),
  variant_id uuid not null references public.variants(id),
  code text not null unique check (btrim(code) <> ''),
  symbology text not null check (symbology in ('EAN13', 'CODE128', 'LEGACY')),
  source text not null check (source in ('SICAR', 'GENERATED', 'MANUAL', 'SUPPLIER')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index barcodes_variant_id_idx on public.barcodes (variant_id);
create unique index barcodes_primary_variant_idx on public.barcodes (variant_id) where is_primary;

create or replace function app.protect_legacy_codes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.legacy_sicar_code is not null
     and new.legacy_sicar_code is distinct from old.legacy_sicar_code then
    raise exception 'LEGACY_CODE_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger variants_protect_legacy_codes
before update on public.variants
for each row execute function app.protect_legacy_codes();

create or replace function app.protect_sicar_barcode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source = 'SICAR' and (
    tg_op = 'DELETE'
    or new.code is distinct from old.code
    or new.variant_id is distinct from old.variant_id
  ) then
    raise exception 'SICAR_BARCODE_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger barcodes_protect_sicar
before update or delete on public.barcodes
for each row execute function app.protect_sicar_barcode();

create trigger brands_touch_updated_at before update on public.brands
for each row execute function app.touch_updated_at();
create trigger categories_touch_updated_at before update on public.categories
for each row execute function app.touch_updated_at();
create trigger products_touch_updated_at before update on public.products
for each row execute function app.touch_updated_at();
create trigger variants_touch_updated_at before update on public.variants
for each row execute function app.touch_updated_at();

create trigger products_audit after insert or update on public.products
for each row execute function app.audit_row_change();
create trigger variants_audit after insert or update on public.variants
for each row execute function app.audit_row_change();
create trigger barcodes_audit after insert or update or delete on public.barcodes
for each row execute function app.audit_row_change();

insert into public.size_scales (code, name) values
  ('CALZADO_MX', 'Calzado México'),
  ('ROPA_LETRA', 'Ropa por letra'),
  ('ROPA_NUMERO', 'Ropa por número'),
  ('SOMBRERO', 'Sombreros y texanas'),
  ('CINTO', 'Cinturones'),
  ('UNITALLA', 'Unitalla');

insert into public.attribute_types (code, name, display_order) values
  ('TALLA', 'Talla', 10),
  ('COLOR', 'Color', 20),
  ('ANCHO', 'Ancho', 30);

insert into public.attribute_values (type_code, scale_code, value, display_order)
select 'TALLA', 'CALZADO_MX', regexp_replace(trim(to_char(value, 'FM99.9')), '\.$', ''), value
from generate_series(22.0, 31.0, 0.5) value;

insert into public.attribute_values (type_code, scale_code, value, display_order) values
  ('TALLA', 'ROPA_LETRA', 'CH', 10),
  ('TALLA', 'ROPA_LETRA', 'M', 20),
  ('TALLA', 'ROPA_LETRA', 'G', 30),
  ('TALLA', 'ROPA_LETRA', 'XG', 40),
  ('TALLA', 'ROPA_LETRA', 'XXG', 50),
  ('TALLA', 'UNITALLA', 'Única', 10);

insert into public.attribute_values (type_code, value, display_order) values
  ('COLOR', 'Negro', 10),
  ('COLOR', 'Café', 20),
  ('COLOR', 'Miel', 30),
  ('COLOR', 'Tan', 40),
  ('COLOR', 'Azul', 50),
  ('COLOR', 'Rojo', 60),
  ('COLOR', 'Blanco', 70);

insert into public.attribute_values (type_code, scale_code, value, display_order)
select 'TALLA', 'ROPA_NUMERO', value::text, value
from generate_series(28, 44, 2) value;

insert into public.categories (name, default_size_scale_code) values
  ('Botas', 'CALZADO_MX'),
  ('Calzado', 'CALZADO_MX'),
  ('Camisas', 'ROPA_LETRA'),
  ('Pantalones', 'ROPA_NUMERO'),
  ('Sombreros y texanas', 'SOMBRERO'),
  ('Cinturones', 'CINTO'),
  ('Bolsas y carteras', 'UNITALLA'),
  ('Accesorios', 'UNITALLA');

create or replace function public.create_catalog_product(
  p_name text,
  p_category_id uuid,
  p_variants jsonb,
  p_brand_id uuid default null,
  p_description text default null,
  p_brand_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_product_id uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_brand_id uuid := p_brand_id;
  v_attribute record;
  v_count integer := 0;
begin
  if v_actor is null or not (select app.has_perm('products.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null
     or p_category_id is null
     or jsonb_typeof(p_variants) <> 'array'
     or jsonb_array_length(p_variants) < 1
     or jsonb_array_length(p_variants) > 200 then
    raise exception 'INVALID_CATALOG_PRODUCT' using errcode = '22023';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id and is_active) then
    raise exception 'INVALID_CATEGORY' using errcode = '22023';
  end if;
  if v_brand_id is not null and not exists (select 1 from public.brands where id = v_brand_id and is_active) then
    raise exception 'INVALID_BRAND' using errcode = '22023';
  end if;

  if v_brand_id is null and nullif(btrim(p_brand_name), '') is not null then
    insert into public.brands (name)
    values (btrim(p_brand_name))
    on conflict ((lower(btrim(name)))) do update set is_active = true
    returning id into v_brand_id;
  end if;

  insert into public.products (name, brand_id, category_id, description, created_by, updated_by)
  values (btrim(p_name), v_brand_id, p_category_id, nullif(btrim(p_description), ''), v_actor, v_actor)
  returning id into v_product_id;

  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    if nullif(btrim(v_variant ->> 'sku'), '') is null
       or nullif(btrim(v_variant ->> 'barcode'), '') is null
       or coalesce((v_variant ->> 'cost_cents')::bigint, -1) < 0
       or coalesce((v_variant ->> 'price_cents')::bigint, -1) < 0 then
      raise exception 'INVALID_VARIANT' using errcode = '22023';
    end if;

    insert into public.variants (
      product_id, sku, cost_cents, price_cents, legacy_sicar_code,
      woocommerce_product_id, woocommerce_variation_id, created_by, updated_by
    ) values (
      v_product_id,
      upper(btrim(v_variant ->> 'sku')),
      (v_variant ->> 'cost_cents')::bigint,
      (v_variant ->> 'price_cents')::bigint,
      nullif(btrim(v_variant ->> 'legacy_sicar_code'), ''),
      nullif(v_variant ->> 'woocommerce_product_id', '')::bigint,
      nullif(v_variant ->> 'woocommerce_variation_id', '')::bigint,
      v_actor,
      v_actor
    ) returning id into v_variant_id;

    for v_attribute in
      select key as type_code, value as value_id
      from jsonb_each_text(coalesce(v_variant -> 'attributes', '{}'::jsonb))
    loop
      if not exists (
        select 1 from public.attribute_values av
        where av.id = v_attribute.value_id::uuid and av.type_code = v_attribute.type_code
      ) then
        raise exception 'INVALID_VARIANT_ATTRIBUTE' using errcode = '22023';
      end if;
      insert into public.variant_attributes (variant_id, type_code, value_id)
      values (v_variant_id, v_attribute.type_code, v_attribute.value_id::uuid);
    end loop;

    insert into public.barcodes (variant_id, code, symbology, source, is_primary)
    values (
      v_variant_id,
      btrim(v_variant ->> 'barcode'),
      coalesce(nullif(v_variant ->> 'barcode_symbology', ''), 'CODE128'),
      coalesce(nullif(v_variant ->> 'barcode_source', ''), 'MANUAL'),
      true
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('product_id', v_product_id, 'variant_count', v_count);
exception
  when unique_violation then
    raise exception 'CATALOG_DUPLICATE_VALUE' using errcode = '23505';
end;
$$;

create or replace function public.search_catalog(
  p_query text default '',
  p_limit integer default 100
)
returns table (
  variant_id uuid,
  product_id uuid,
  product_name text,
  brand_name text,
  category_name text,
  sku text,
  legacy_sicar_code text,
  primary_barcode text,
  price_cents bigint,
  cost_cents bigint,
  attributes jsonb,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_can_see_cost boolean := (select app.has_perm('reports.inventory'))
    or (select app.has_perm('purchases.manage'));
begin
  if (select app.current_user_id()) is null or not (select app.has_perm('products.read')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  select
    v.id, p.id, p.name, coalesce(b.name, 'Sin marca'), c.name, v.sku,
    v.legacy_sicar_code, bc.code, v.price_cents,
    case when v_can_see_cost then v.cost_cents else null end,
    coalesce(attrs.values, '{}'::jsonb), v.is_active
  from public.variants v
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  left join public.brands b on b.id = p.brand_id
  left join lateral (
    select code from public.barcodes
    where variant_id = v.id and is_primary
    limit 1
  ) bc on true
  left join lateral (
    select jsonb_object_agg(va.type_code, av.value order by at.display_order) as values
    from public.variant_attributes va
    join public.attribute_values av on av.id = va.value_id
    join public.attribute_types at on at.code = va.type_code
    where va.variant_id = v.id
  ) attrs on true
  where (
    v_query = ''
    or lower(p.search_name) like '%' || v_query || '%'
    or lower(v.sku) like '%' || v_query || '%'
    or lower(coalesce(v.legacy_sicar_code, '')) like '%' || v_query || '%'
    or lower(coalesce(b.name, '')) like '%' || v_query || '%'
    or exists (
      select 1 from public.barcodes bx
      where bx.variant_id = v.id and lower(bx.code) like '%' || v_query || '%'
    )
  )
  order by p.name, v.sku
  limit v_limit;
end;
$$;

alter table public.brands enable row level security;
alter table public.size_scales enable row level security;
alter table public.categories enable row level security;
alter table public.attribute_types enable row level security;
alter table public.attribute_values enable row level security;
alter table public.products enable row level security;
alter table public.variants enable row level security;
alter table public.variant_attributes enable row level security;
alter table public.barcodes enable row level security;

create policy brands_select on public.brands for select to authenticated
using ((select app.has_perm('products.read')));
create policy size_scales_select on public.size_scales for select to authenticated
using ((select app.has_perm('products.read')));
create policy categories_select on public.categories for select to authenticated
using ((select app.has_perm('products.read')));
create policy attribute_types_select on public.attribute_types for select to authenticated
using ((select app.has_perm('products.read')));
create policy attribute_values_select on public.attribute_values for select to authenticated
using ((select app.has_perm('products.read')));
create policy products_select on public.products for select to authenticated
using ((select app.has_perm('products.read')));

revoke all on public.brands, public.size_scales, public.categories,
  public.attribute_types, public.attribute_values, public.products,
  public.variants, public.variant_attributes, public.barcodes
from anon, authenticated;

grant select on public.brands, public.size_scales, public.categories,
  public.attribute_types, public.attribute_values, public.products
to authenticated;

grant select, insert, update, delete on public.brands, public.size_scales,
  public.categories, public.attribute_types, public.attribute_values,
  public.products, public.variants, public.variant_attributes, public.barcodes
to service_role;

revoke execute on function app.protect_legacy_codes() from public, anon, authenticated;
revoke execute on function app.protect_sicar_barcode() from public, anon, authenticated;
revoke execute on function public.create_catalog_product(text, uuid, jsonb, uuid, text, text)
from public, anon;
revoke execute on function public.search_catalog(text, integer) from public, anon;
grant execute on function public.create_catalog_product(text, uuid, jsonb, uuid, text, text)
to authenticated;
grant execute on function public.search_catalog(text, integer) to authenticated;

commit;
