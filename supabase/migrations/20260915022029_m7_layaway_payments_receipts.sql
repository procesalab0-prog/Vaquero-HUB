begin;

insert into public.folio_document_types (code, description)
values ('LAYAWAY_PAYMENT', 'Abono de apartado')
on conflict (code) do nothing;

insert into public.cash_movement_types (code, description)
values ('LAYAWAY_PAYMENT', 'Abono en efectivo de un apartado')
on conflict (code) do nothing;

create table public.layaway_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  layaway_id uuid not null references public.layaways(id),
  cash_session_id uuid not null references public.cash_sessions(id),
  location_id uuid not null references public.locations(id),
  actor_user_id uuid not null references public.app_users(id),
  folio_number bigint not null check (folio_number > 0),
  folio text not null unique check (btrim(folio) <> ''),
  total_cents bigint not null check (total_cents > 0),
  balance_before_cents bigint not null check (balance_before_cents > 0),
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  idempotency_key uuid not null unique,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  note text check (note is null or length(btrim(note)) between 3 and 500),
  received_at timestamptz not null default now(),
  unique (location_id, folio_number),
  check (balance_after_cents = balance_before_cents - total_cents)
);

create table public.layaway_payment_parts (
  id uuid primary key default extensions.gen_random_uuid(),
  layaway_payment_id uuid not null references public.layaway_payments(id),
  method_code text not null references public.payment_methods(code)
    check (method_code <> 'CREDIT'),
  amount_cents bigint not null check (amount_cents > 0),
  tendered_cents bigint,
  change_cents bigint not null default 0 check (change_cents >= 0),
  reference text,
  created_at timestamptz not null default now(),
  unique (layaway_payment_id, method_code),
  constraint layaway_payment_part_cash_fields check (
    (method_code = 'CASH' and tendered_cents is not null
      and tendered_cents >= amount_cents
      and change_cents = tendered_cents - amount_cents)
    or
    (method_code <> 'CASH' and tendered_cents is null and change_cents = 0)
  )
);

create index layaway_payments_layaway_date_idx
  on public.layaway_payments (layaway_id, received_at desc, id);
create index layaway_payments_session_date_idx
  on public.layaway_payments (cash_session_id, received_at desc, id);
create index layaway_payment_parts_payment_idx
  on public.layaway_payment_parts (layaway_payment_id);

create trigger layaway_payments_guard
before insert or update or delete on public.layaway_payments
for each row execute function app.guard_layaway_write();
create trigger layaway_payment_parts_guard
before insert or update or delete on public.layaway_payment_parts
for each row execute function app.guard_layaway_write();

create function public.record_layaway_payment(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_layaway_id uuid,
  p_payments jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_session public.cash_sessions;
  v_layaway public.layaways;
  v_existing public.layaway_payments;
  v_payment public.layaway_payments;
  v_method public.payment_methods;
  v_part jsonb;
  v_hash text;
  v_amount bigint;
  v_total bigint := 0;
  v_folio bigint;
begin
  if v_actor is null or not (select app.has_perm('layaways.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_cash_session_id is null or p_layaway_id is null
     or p_payments is null or jsonb_typeof(p_payments) <> 'array'
     or jsonb_array_length(p_payments) not between 1 and 3
     or length(coalesce(p_note, '')) > 500
     or exists (select 1 from jsonb_array_elements(p_payments) p
       group by upper(p->>'method_code') having count(*) > 1) then
    raise exception 'INVALID_LAYAWAY_PAYMENT' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'session', p_cash_session_id, 'layaway', p_layaway_id,
    'payments', p_payments, 'note', nullif(btrim(coalesce(p_note, '')), '')
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('layaway-payment:' || p_idempotency_key::text, 0));
  select * into v_existing from public.layaway_payments
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id <> v_actor or v_existing.request_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_existing.id, 'folio', v_existing.folio,
      'total_cents', v_existing.total_cents,
      'balance_before_cents', v_existing.balance_before_cents,
      'balance_cents', v_existing.balance_after_cents,
      'received_at', v_existing.received_at);
  end if;

  select * into v_session from public.cash_sessions
  where id = p_cash_session_id and status = 'OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor
     or not (select app.can_access_location(v_session.location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('layaway:' || p_layaway_id::text, 0));
  select * into v_layaway from public.layaways
  where id = p_layaway_id for update;
  if not found or v_layaway.location_id <> v_session.location_id then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_layaway.status not in ('OPEN', 'PARTIALLY_PAID') or v_layaway.balance_cents <= 0 then
    raise exception 'LAYAWAY_NOT_PAYABLE' using errcode = '23514';
  end if;

  for v_part in select value from jsonb_array_elements(p_payments) loop
    begin v_amount := (v_part->>'amount_cents')::bigint;
    exception when others then raise exception 'INVALID_LAYAWAY_PAYMENT' using errcode = '22023'; end;
    select * into v_method from public.payment_methods
    where code = upper(v_part->>'method_code') and is_active and code <> 'CREDIT';
    if not found or v_amount is null or v_amount <= 0 then
      raise exception 'INVALID_LAYAWAY_PAYMENT' using errcode = '22023';
    end if;
    if v_method.requires_reference and length(btrim(coalesce(v_part->>'reference', ''))) < 3 then
      raise exception 'PAYMENT_REFERENCE_REQUIRED' using errcode = '22023';
    end if;
    if v_method.kind = 'CASH' then
      begin
        if coalesce((v_part->>'tendered_cents')::bigint, -1) < v_amount then
          raise exception 'INSUFFICIENT_CASH_TENDERED' using errcode = '22023';
        end if;
      exception when invalid_text_representation then
        raise exception 'INVALID_LAYAWAY_PAYMENT' using errcode = '22023';
      end;
    end if;
    v_total := v_total + v_amount;
  end loop;
  if v_total > v_layaway.balance_cents then
    raise exception 'LAYAWAY_OVERPAYMENT' using errcode = '23514';
  end if;

  insert into public.folios(location_id, document_type, next_number)
  values(v_session.location_id, 'LAYAWAY_PAYMENT', 2)
  on conflict(location_id, document_type) do update
    set next_number = public.folios.next_number + 1
  returning next_number - 1 into v_folio;

  perform set_config('app.layaway_write', 'on', true);
  insert into public.layaway_payments(
    layaway_id, cash_session_id, location_id, actor_user_id,
    folio_number, folio, total_cents, balance_before_cents,
    balance_after_cents, idempotency_key, request_hash, note
  ) values (
    v_layaway.id, v_session.id, v_session.location_id, v_actor,
    v_folio, (select code from public.locations where id = v_session.location_id)
      || '-AA-' || lpad(v_folio::text, 6, '0'),
    v_total, v_layaway.balance_cents, v_layaway.balance_cents - v_total,
    p_idempotency_key, v_hash, nullif(btrim(coalesce(p_note, '')), '')
  ) returning * into v_payment;

  for v_part in select value from jsonb_array_elements(p_payments) loop
    v_amount := (v_part->>'amount_cents')::bigint;
    select * into v_method from public.payment_methods where code = upper(v_part->>'method_code');
    if v_method.kind = 'CASH' then
      insert into public.layaway_payment_parts(
        layaway_payment_id, method_code, amount_cents, tendered_cents, change_cents
      ) values (v_payment.id, v_method.code, v_amount,
        (v_part->>'tendered_cents')::bigint,
        (v_part->>'tendered_cents')::bigint - v_amount);
    else
      insert into public.layaway_payment_parts(
        layaway_payment_id, method_code, amount_cents, reference
      ) values (v_payment.id, v_method.code, v_amount, btrim(v_part->>'reference'));
    end if;
  end loop;

  update public.layaways set
    paid_cents = paid_cents + v_total,
    balance_cents = balance_cents - v_total,
    status = case when balance_cents - v_total = 0 then 'PAID' else 'PARTIALLY_PAID' end,
    updated_at = now()
  where id = v_layaway.id;
  perform set_config('app.layaway_write', 'off', true);

  perform set_config('app.cash_write', 'on', true);
  insert into public.cash_movements(
    session_id, location_id, movement_type, amount_cents, reference_type,
    reference_id, user_id, metadata
  )
  select v_session.id, v_session.location_id, 'LAYAWAY_PAYMENT', sum(pp.amount_cents),
    'LAYAWAY_PAYMENT', v_payment.id::text, v_actor,
    jsonb_build_object('folio', v_payment.folio, 'layaway_id', v_layaway.id)
  from public.layaway_payment_parts pp
  join public.payment_methods pm on pm.code = pp.method_code
  where pp.layaway_payment_id = v_payment.id and pm.kind = 'CASH'
  having sum(pp.amount_cents) > 0;
  perform set_config('app.cash_write', 'off', true);

  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, metadata)
  values (v_actor, 'layaway.payment_received', 'layaway_payments', v_payment.id::text,
    v_session.location_id, jsonb_build_object('layaway_id', v_layaway.id,
      'total_cents', v_total, 'balance_before_cents', v_layaway.balance_cents,
      'balance_after_cents', v_layaway.balance_cents - v_total,
      'payment_count', jsonb_array_length(p_payments)));
  return jsonb_build_object('id', v_payment.id, 'folio', v_payment.folio,
    'total_cents', v_total, 'balance_before_cents', v_layaway.balance_cents,
    'balance_cents', v_layaway.balance_cents - v_total,
    'received_at', v_payment.received_at);
end;
$$;

create function public.get_layaway_payment_receipt(p_payment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := (select app.current_user_id()); v_result jsonb; v_location uuid;
begin
  if v_actor is null or not (select app.has_perm('layaways.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select location_id into v_location from public.layaway_payments where id = p_payment_id;
  if v_location is null then raise exception 'LAYAWAY_PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (select app.can_access_location(v_location)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', p.id, 'folio', p.folio, 'received_at', p.received_at,
    'total_cents', p.total_cents, 'balance_before_cents', p.balance_before_cents,
    'balance_cents', p.balance_after_cents, 'note', p.note,
    'layaway_id', l.id, 'layaway_folio', l.folio,
    'customer_name', c.full_name, 'member_number', c.member_number,
    'location_name', loc.name, 'location_address', loc.address,
    'location_phone', loc.phone, 'cashier_name', u.full_name, 'register_name', r.name,
    'parts', coalesce((select jsonb_agg(jsonb_build_object(
      'method_code', pp.method_code, 'method_name', pm.name,
      'amount_cents', pp.amount_cents, 'reference', pp.reference)
      order by pm.sort_order, pp.id)
      from public.layaway_payment_parts pp join public.payment_methods pm on pm.code=pp.method_code
      where pp.layaway_payment_id=p.id), '[]'::jsonb)
  ) into v_result
  from public.layaway_payments p
  join public.layaways l on l.id=p.layaway_id
  join public.customers c on c.id=l.customer_id
  join public.locations loc on loc.id=p.location_id
  join public.app_users u on u.id=p.actor_user_id
  join public.cash_sessions s on s.id=p.cash_session_id
  join public.cash_registers r on r.id=s.register_id
  where p.id=p_payment_id;
  return v_result;
end;
$$;

alter table public.layaway_payments enable row level security;
alter table public.layaway_payment_parts enable row level security;
create policy layaway_payments_rpc_only on public.layaway_payments
for all to authenticated using (false) with check (false);
create policy layaway_payment_parts_rpc_only on public.layaway_payment_parts
for all to authenticated using (false) with check (false);
revoke all on public.layaway_payments, public.layaway_payment_parts
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.layaway_payments, public.layaway_payment_parts
  to service_role;
revoke execute on function public.record_layaway_payment(uuid,uuid,uuid,jsonb,text),
  public.get_layaway_payment_receipt(uuid) from public, anon;
grant execute on function public.record_layaway_payment(uuid,uuid,uuid,jsonb,text),
  public.get_layaway_payment_receipt(uuid) to authenticated, service_role;

commit;
