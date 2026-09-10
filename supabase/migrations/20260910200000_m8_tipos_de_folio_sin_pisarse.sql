begin;

-- `folios.document_type` se validaba con un CHECK que cada módulo tenía que
-- soltar y volver a escribir completo. Ya falló una vez: M8 agregó 'QUOTE' y
-- en el camino borró 'RETURN', así que al desplegar, las devoluciones se
-- quedaron sin folio. Se arregló con otra migración, pero el patrón sigue ahí
-- y M7 va a tocarlo de nuevo para los apartados.
--
-- Se cambia por una tabla de tipos con llave foránea: agregar un tipo pasa a
-- ser un INSERT, y ya no hay una lista completa que alguien pueda reescribir
-- de memoria olvidando la mitad. Lo que antes dependía de recordar, ahora lo
-- garantiza la estructura.
create table public.folio_document_types (
  code text primary key
    check (code = upper(btrim(code)) and btrim(code) <> ''),
  description text not null check (btrim(description) <> ''),
  created_at timestamptz not null default now()
);

insert into public.folio_document_types (code, description) values
  ('SALE', 'Venta'),
  ('RETURN', 'Devolución o cambio'),
  ('QUOTE', 'Cotización')
on conflict (code) do nothing;

alter table public.folios drop constraint folios_document_type_check;
alter table public.folios
  add constraint folios_document_type_fkey
  foreign key (document_type) references public.folio_document_types(code);

alter table public.folio_document_types enable row level security;

comment on table public.folio_document_types is
  'Tipos de documento con folio propio. Para agregar uno, INSERTA aquí: no vuelvas a escribir un CHECK con la lista completa, que es como se perdieron los folios de devolución al desplegar M8.2.';

commit;
