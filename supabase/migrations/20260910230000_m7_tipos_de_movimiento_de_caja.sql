begin;

-- Misma trampa que la de los folios, en otra columna. `movement_type` de
-- `cash_movements` se valida con un CHECK que trae la lista completa, así que
-- cada módulo que agrega un tipo tiene que soltarlo y reescribirlo entero. Ya
-- van tres veces: M4 agregó CANCELLATION, M5 agregó RETURN y M7 agregó
-- CREDIT_PAYMENT. Las tres salieron bien de milagro; la de folios falló a la
-- segunda y dejó las devoluciones sin folio al desplegar.
--
-- Aquí el descuido costaría más: si alguien reescribe la lista y se le va
-- 'SALE', deja de poder entrar dinero de las ventas a la caja.
create table public.cash_movement_types (
  code text primary key
    check (code = upper(btrim(code)) and btrim(code) <> ''),
  description text not null check (btrim(description) <> ''),
  created_at timestamptz not null default now()
);

insert into public.cash_movement_types (code, description) values
  ('OPENING', 'Fondo inicial del turno'),
  ('SALE', 'Efectivo cobrado en una venta'),
  ('DEPOSIT', 'Entrada manual de efectivo'),
  ('WITHDRAWAL', 'Retiro manual de efectivo'),
  ('CLOSING', 'Cierre del turno'),
  ('CANCELLATION', 'Reverso por venta cancelada'),
  ('RETURN', 'Movimiento por devolución o cambio'),
  ('CREDIT_PAYMENT', 'Abono de un cliente a su crédito')
on conflict (code) do nothing;

alter table public.cash_movements drop constraint cash_movements_movement_type_check;
alter table public.cash_movements
  add constraint cash_movements_movement_type_fkey
  foreign key (movement_type) references public.cash_movement_types(code);

alter table public.cash_movement_types enable row level security;

comment on table public.cash_movement_types is
  'Tipos de movimiento del libro de caja. Para agregar uno, INSERTA aquí: no vuelvas a escribir un CHECK con la lista completa. Así se perdieron los folios de devolución al desplegar M8.2.';

commit;
