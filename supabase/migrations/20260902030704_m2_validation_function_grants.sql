begin;

-- Las restricciones de identidad llaman estas funciones durante escrituras
-- legítimas del backend. Se mantienen cerradas para anon/authenticated y se
-- habilitan únicamente para el rol servidor de Supabase.
grant execute on function app.luhn_check_digit(text) to service_role;
grant execute on function app.ean13_check_digit(text) to service_role;
grant execute on function app.is_valid_variant_sku(text) to service_role;
grant execute on function app.is_valid_generated_barcode(text) to service_role;

commit;
