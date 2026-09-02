begin;

create or replace function app.is_valid_variant_sku(p_sku text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_sku ~ '^[0-9]{7,18}-[0-9]$'
    and right(p_sku, 1)::integer = app.luhn_check_digit(split_part(p_sku, '-', 1))
$$;

create or replace function app.is_valid_generated_barcode(p_code text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_code ~ '^20[0-9]{11}$'
    and right(p_code, 1)::integer = app.ean13_check_digit(left(p_code, 12))
$$;

alter table public.variants
  add constraint variants_sku_format_check
  check (app.is_valid_variant_sku(sku)) not valid;
alter table public.variants validate constraint variants_sku_format_check;

alter table public.barcodes
  add constraint barcodes_generated_identity_check
  check (
    source <> 'GENERATED'
    or (symbology = 'EAN13' and app.is_valid_generated_barcode(code))
  ) not valid;
alter table public.barcodes validate constraint barcodes_generated_identity_check;

revoke execute on function app.is_valid_variant_sku(text)
from public, anon, authenticated;
revoke execute on function app.is_valid_generated_barcode(text)
from public, anon, authenticated;

commit;
