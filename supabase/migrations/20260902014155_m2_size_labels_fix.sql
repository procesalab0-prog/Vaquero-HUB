begin;

-- Los valores enteros sembrados con to_char('FM99.9') quedaron como "25."
-- en PostgreSQL. Además de verse mal en la interfaz, el punto final rompe la
-- comparación exacta y puede generar códigos distintos para la misma talla.
update public.attribute_values
set value = regexp_replace(value, '\.$', '')
where type_code = 'TALLA'
  and scale_code = 'CALZADO_MX'
  and value ~ '^[0-9]+\.$';

commit;
