begin;

-- Los tipos dejan de vivir en un CHECK que cada módulo debía reescribir.
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
  'Tipos de movimiento del libro de caja. Para agregar uno, INSERTA aquí; no reescribas un CHECK con la lista completa.';

commit;
