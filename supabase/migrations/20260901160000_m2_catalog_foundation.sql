begin;

-- =====================================================================
-- M2 — Catálogo: productos, variantes, atributos y códigos
-- Especificación: docs/specs/M2_CATALOGO.md
--
-- El producto padre agrupa y da nombre. Todo el dinero y, más adelante,
-- todo el inventario viven en la variante.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Escalas de talla
--
-- Una bota no usa la misma escala que una camisa ni que un sombrero. La
-- categoría sugiere la escala y el generador de variantes la ofrece.
-- ---------------------------------------------------------------------
create table public.size_scales (
  code       text primary key,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.brands (
  id         uuid primary key default extensions.gen_random_uuid(),
  name       text not null unique check (btrim(name) <> ''),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id                      uuid primary key default extensions.gen_random_uuid(),
  name                    text not null unique check (btrim(name) <> ''),
  default_size_scale_code text references public.size_scales(code),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Atributos de variante
-- ---------------------------------------------------------------------
create table public.attribute_types (
  code          text primary key,
  name          text not null,
  display_order int not null default 0
);

create table public.attribute_values (
  id            uuid primary key default extensions.gen_random_uuid(),
  type_code     text not null references public.attribute_types(code),
  scale_code    text references public.size_scales(code),
  value         text not null check (btrim(value) <> ''),
  -- display_order es numeric y no es opcional: las tallas son texto, y
  -- ordenarlas alfabéticamente pone la 10 antes de la 9 y la 25.5
  -- después de la 26. Todo listado ordena por esta columna.
  display_order numeric not null default 0,
  is_active     boolean not null default true,
  -- nulls not distinct: sin esto, scale_code nulo (el color, por ejemplo)
  -- permitiría insertar 'Negro' cien veces, porque PostgreSQL considera
  -- los nulos distintos entre sí en un índice único.
  constraint attribute_values_unicos unique nulls not distinct (type_code, scale_code, value)
);

create index attribute_values_type_scale_idx
  on public.attribute_values (type_code, scale_code, display_order);

-- ---------------------------------------------------------------------
-- Producto padre y variantes
-- ---------------------------------------------------------------------
create table public.products (
  id          uuid primary key default extensions.gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  search_name text generated always as (
    lower(translate(name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
  ) stored,
  brand_id    uuid references public.brands(id),
  category_id uuid not null references public.categories(id),
  description text,
  is_active   boolean not null default true,
  created_by  uuid references public.app_users(id),
  updated_by  uuid references public.app_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index products_search_name_idx on public.products (search_name);
create index products_category_idx on public.products (category_id);
create index products_brand_idx on public.products (brand_id) where brand_id is not null;

create table public.variants (
  id          uuid primary key default extensions.gen_random_uuid(),
  product_id  uuid not null references public.products(id),
  sku         text not null unique check (btrim(sku) <> ''),
  cost_cents  bigint not null default 0 check (cost_cents >= 0),
  price_cents bigint not null default 0 check (price_cents >= 0),

  -- Aterrizaje de la migración de SICAR. Se crean ahora aunque se llenen
  -- mucho después. legacy_sicar_code es el código interno del artículo en
  -- SICAR; los códigos de barras viven en public.barcodes y sólo ahí.
  legacy_sicar_code        text unique,
  woocommerce_product_id   bigint,
  woocommerce_variation_id bigint unique,

  is_active   boolean not null default true,
  created_by  uuid references public.app_users(id),
  updated_by  uuid references public.app_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index variants_product_idx on public.variants (product_id);
create index variants_legacy_sicar_idx on public.variants (legacy_sicar_code)
  where legacy_sicar_code is not null;
create index variants_woo_product_idx on public.variants (woocommerce_product_id)
  where woocommerce_product_id is not null;

create table public.variant_attributes (
  variant_id uuid not null references public.variants(id) on delete cascade,
  type_code  text not null references public.attribute_types(code),
  value_id   uuid not null references public.attribute_values(id),
  -- La llave primaria impide que una variante tenga dos colores.
  primary key (variant_id, type_code)
);

create index variant_attributes_value_idx on public.variant_attributes (value_id);

-- ---------------------------------------------------------------------
-- Códigos de barras
--
-- Tabla aparte y no una columna, porque una variante puede tener varios:
-- el del fabricante, el que imprime la tienda y el heredado de SICAR.
-- Escanear cualquiera debe encontrar la misma variante.
-- ---------------------------------------------------------------------
create table public.barcodes (
  id         uuid primary key default extensions.gen_random_uuid(),
  variant_id uuid not null references public.variants(id),
  code       text not null unique check (btrim(code) <> ''),
  symbology  text not null check (symbology in ('EAN13','CODE128','LEGACY')),
  source     text not null check (source in ('SICAR','GENERATED','MANUAL','SUPPLIER')),
  is_primary boolean not null default false,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

create index barcodes_variant_idx on public.barcodes (variant_id);
create unique index barcodes_uno_primario_idx
  on public.barcodes (variant_id) where is_primary;

-- ---------------------------------------------------------------------
-- Los códigos heredados son inmutables
--
-- La regla 1 del plan de ejecución, implementada como disparador y no
-- como buena intención: una vez que un código de SICAR aterriza, nadie
-- lo cambia. Ni un administrador, ni la interfaz, ni un script.
-- ---------------------------------------------------------------------
create or replace function app.protect_legacy_codes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.legacy_sicar_code is not null
     and new.legacy_sicar_code is distinct from old.legacy_sicar_code then
    raise exception 'LEGACY_CODE_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger variants_protect_legacy_codes
before update on public.variants
for each row execute function app.protect_legacy_codes();

-- Un código de barras de origen SICAR tampoco se edita ni se borra.
create or replace function app.protect_legacy_barcodes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source = 'SICAR' then
    raise exception 'LEGACY_BARCODE_IMMUTABLE' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger barcodes_protect_legacy
before update or delete on public.barcodes
for each row execute function app.protect_legacy_barcodes();

-- ---------------------------------------------------------------------
-- updated_at y bitácora
-- ---------------------------------------------------------------------
create trigger brands_touch_updated_at before update on public.brands
  for each row execute function app.touch_updated_at();
create trigger categories_touch_updated_at before update on public.categories
  for each row execute function app.touch_updated_at();
create trigger products_touch_updated_at before update on public.products
  for each row execute function app.touch_updated_at();
create trigger variants_touch_updated_at before update on public.variants
  for each row execute function app.touch_updated_at();

-- audit_row_change guarda before_data y after_data, que es lo que permite
-- responder «quién bajó este precio y cuándo» en el reporte de M8.
create trigger products_audit after insert or update or delete on public.products
  for each row execute function app.audit_row_change();
create trigger variants_audit after insert or update or delete on public.variants
  for each row execute function app.audit_row_change();
create trigger barcodes_audit after insert or update or delete on public.barcodes
  for each row execute function app.audit_row_change();
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function app.audit_row_change();
create trigger brands_audit after insert or update or delete on public.brands
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------
-- RLS
--
-- El catálogo no se segmenta por sucursal: un producto es el mismo en
-- todas. Las existencias sí se segmentan, y eso llega en M3.
-- ---------------------------------------------------------------------
alter table public.size_scales        enable row level security;
alter table public.brands             enable row level security;
alter table public.categories         enable row level security;
alter table public.attribute_types    enable row level security;
alter table public.attribute_values   enable row level security;
alter table public.products           enable row level security;
alter table public.variants           enable row level security;
alter table public.variant_attributes enable row level security;
alter table public.barcodes           enable row level security;

-- Las llamadas a funciones van envueltas en subselect a propósito: así
-- PostgreSQL las evalúa una vez por consulta y no una vez por fila. Sobre
-- 15,000 variantes la diferencia decide si el catálogo abre o se arrastra.
create policy size_scales_select on public.size_scales
  for select to authenticated using ((select app.has_perm('products.read')));
create policy brands_select on public.brands
  for select to authenticated using ((select app.has_perm('products.read')));
create policy categories_select on public.categories
  for select to authenticated using ((select app.has_perm('products.read')));
create policy attribute_types_select on public.attribute_types
  for select to authenticated using ((select app.has_perm('products.read')));
create policy attribute_values_select on public.attribute_values
  for select to authenticated using ((select app.has_perm('products.read')));
create policy products_select on public.products
  for select to authenticated using ((select app.has_perm('products.read')));
create policy variants_select on public.variants
  for select to authenticated using ((select app.has_perm('products.read')));
create policy variant_attributes_select on public.variant_attributes
  for select to authenticated using ((select app.has_perm('products.read')));
create policy barcodes_select on public.barcodes
  for select to authenticated using ((select app.has_perm('products.read')));

-- Escritura: sólo por funciones SECURITY DEFINER que validan permisos.
-- No se crean políticas de insert/update/delete, así que RLS lo niega.

-- ---------------------------------------------------------------------
-- Privilegios
--
-- cost_cents queda FUERA del grant de columnas: una cajera no ve el
-- margen. Quien necesite el costo lo obtiene por una función que exige
-- reports.inventory o purchases.manage.
--
-- CONSECUENCIA QUE HAY QUE CONOCER: como el permiso es por columna,
-- `select *` sobre variants falla para el rol authenticated. Toda consulta
-- desde la aplicación debe nombrar sus columnas explícitamente
-- (`.select('id, sku, price_cents, ...')`), porque PostgREST pide `*` por
-- omisión. Es el precio de esconder el costo, y es el correcto: la
-- alternativa es que el margen viaje al navegador de cualquier cajera.
-- ---------------------------------------------------------------------
revoke all on public.size_scales, public.brands, public.categories,
              public.attribute_types, public.attribute_values,
              public.products, public.variants,
              public.variant_attributes, public.barcodes
  from anon, authenticated;

grant select on public.size_scales, public.brands, public.categories,
                public.attribute_types, public.attribute_values,
                public.products, public.variant_attributes, public.barcodes
  to authenticated;

grant select (id, product_id, sku, price_cents, legacy_sicar_code,
              woocommerce_product_id, woocommerce_variation_id,
              is_active, created_by, updated_by, created_at, updated_at)
  on public.variants to authenticated;

grant select, insert, update on
  public.size_scales, public.brands, public.categories,
  public.attribute_types, public.attribute_values,
  public.products, public.variants,
  public.variant_attributes, public.barcodes
  to service_role;

revoke execute on function app.protect_legacy_codes() from public, anon, authenticated;
revoke execute on function app.protect_legacy_barcodes() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Semilla
--
-- Sólo lo que no depende de una decisión del cliente. Las escalas de
-- sombreros y cinturones están pendientes de confirmar (preguntas 1.3 y
-- 1.4 de docs/PREGUNTAS_CLIENTE.md) y no se inventan aquí.
-- ---------------------------------------------------------------------
insert into public.attribute_types (code, name, display_order) values
  ('TALLA', 'Talla', 1),
  ('COLOR', 'Color', 2),
  ('ANCHO', 'Ancho', 3);

insert into public.size_scales (code, name) values
  ('CALZADO_MX',  'Calzado mexicano'),
  ('ROPA_LETRA',  'Ropa por letra'),
  ('ROPA_NUMERO', 'Ropa por número'),
  ('UNITALLA',    'Unitalla');

-- Calzado mexicano: de 22 a 31 en medias tallas.
insert into public.attribute_values (type_code, scale_code, value, display_order)
select 'TALLA', 'CALZADO_MX', trim(to_char(t, 'FM999.0')), t
from generate_series(22.0, 31.0, 0.5) as t;

insert into public.attribute_values (type_code, scale_code, value, display_order) values
  ('TALLA', 'ROPA_LETRA', 'CH',  1),
  ('TALLA', 'ROPA_LETRA', 'M',   2),
  ('TALLA', 'ROPA_LETRA', 'G',   3),
  ('TALLA', 'ROPA_LETRA', 'XG',  4),
  ('TALLA', 'ROPA_LETRA', 'XXG', 5);

-- Ropa por número: pantalones de 28 a 44, tallas pares.
insert into public.attribute_values (type_code, scale_code, value, display_order)
select 'TALLA', 'ROPA_NUMERO', t::text, t
from generate_series(28, 44, 2) as t;

-- UNITALLA existe para que una bolsa siga siendo una variante y el
-- sistema no tenga dos caminos según si el producto tiene tallas o no.
insert into public.attribute_values (type_code, scale_code, value, display_order) values
  ('TALLA', 'UNITALLA', 'Unitalla', 1);

commit;
