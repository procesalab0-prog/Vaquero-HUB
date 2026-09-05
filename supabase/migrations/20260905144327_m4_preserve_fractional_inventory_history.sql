begin;

-- Staging alcanzo a validar la restriccion durante la prueba previa porque no
-- contiene movimientos fraccionarios. Produccion conserva dos movimientos
-- historicos que no deben reescribirse. Se normaliza ambos entornos al mismo
-- estado: el historial anterior permanece y toda escritura nueva se valida.
alter table public.inventory_movements
  drop constraint if exists inventory_movement_piece_quantities_integer;
alter table public.inventory_movements
  add constraint inventory_movement_piece_quantities_integer check (
    quantity = trunc(quantity)
    and previous_qty = trunc(previous_qty)
    and new_qty = trunc(new_qty)
  ) not valid;

commit;
