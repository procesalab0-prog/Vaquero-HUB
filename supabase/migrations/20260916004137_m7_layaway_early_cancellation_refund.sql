begin;

-- M7.3 · Excepción autorizada para cancelar un apartado antes de vencer.
-- El historial de abonos no se edita: la decisión financiera se registra en
-- un documento compensatorio y el reembolso conserva los métodos originales.

insert into public.permissions(code, category, description)
values (
  'layaways.cancel_exception',
  'Punto de venta',
  'Cancelar apartados vigentes y decidir devolución o penalización'
)
on conflict (code) do update set
  category = excluded.category,
  description = excluded.description;

insert into public.role_permissions(role_id, permission_code)
select r.id, 'layaways.cancel_exception'
from public.roles r
where r.code in ('ADMIN', 'MANAGER')
on conflict do nothing;

alter table public.layaways
  add column cancellation_refund_cents bigint
    check (cancellation_refund_cents is null or cancellation_refund_cents >= 0);

create table public.layaway_cancellations (
  id uuid primary key default extensions.gen_random_uuid(),
  layaway_id uuid not null unique references public.layaways(id),
  cash_session_id uuid not null references public.cash_sessions(id),
  location_id uuid not null references public.locations(id),
  actor_user_id uuid not null references public.app_users(id),
  paid_cents bigint not null check (paid_cents >= 0),
  refund_cents bigint not null check (refund_cents >= 0),
  penalty_cents bigint not null check (penalty_cents >= 0),
  cancelled_balance_cents bigint not null check (cancelled_balance_cents >= 0),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  operation_key uuid not null unique,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (paid_cents = refund_cents + penalty_cents)
);

create table public.layaway_cancellation_refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  cancellation_id uuid not null references public.layaway_cancellations(id),
  method_code text not null references public.payment_methods(code)
    check (method_code <> 'CREDIT'),
  amount_cents bigint not null check (amount_cents > 0),
  reference text check (
    reference is null or length(btrim(reference)) between 3 and 120
  ),
  created_at timestamptz not null default now(),
  unique (cancellation_id, method_code)
);

create index layaway_cancellations_location_date_idx
  on public.layaway_cancellations(location_id, created_at desc, id);
create index layaway_cancellation_refunds_cancellation_idx
  on public.layaway_cancellation_refunds(cancellation_id);

create trigger layaway_cancellations_guard
before insert or update or delete on public.layaway_cancellations
for each row execute function app.guard_layaway_write();

create trigger layaway_cancellation_refunds_guard
before insert or update or delete on public.layaway_cancellation_refunds
for each row execute function app.guard_layaway_write();

create function public.cancel_active_layaway(
  p_operation_key uuid,
  p_cash_session_id uuid,
  p_layaway_id uuid,
  p_refund_cents bigint,
  p_refund_references jsonb default '[]'::jsonb,
  p_reason text default null
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
  v_existing public.layaway_cancellations;
  v_cancellation public.layaway_cancellations;
  v_hash text;
  v_item record;
  v_refund record;
  v_previous_reserved numeric(12,3);
  v_new_reserved numeric(12,3);
  v_updated integer;
  v_cash_refund bigint := 0;
  v_payment_total bigint := 0;
  v_reference text;
  v_previous_status text;
begin
  if v_actor is null
     or not (select app.has_perm('layaways.cancel_exception')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_operation_key is null or p_cash_session_id is null
     or p_layaway_id is null or p_refund_cents is null
     or p_refund_cents < 0
     or jsonb_typeof(coalesce(p_refund_references, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_refund_references, '[]'::jsonb)) > 3
     or exists (
       select 1
       from jsonb_array_elements(coalesce(p_refund_references, '[]'::jsonb)) x
       group by upper(x->>'method_code') having count(*) > 1
     )
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'INVALID_LAYAWAY_CANCELLATION' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'session', p_cash_session_id,
    'layaway', p_layaway_id,
    'refund_cents', p_refund_cents,
    'refund_references', coalesce(p_refund_references, '[]'::jsonb),
    'reason', btrim(p_reason)
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended('cancel-active-layaway:' || p_operation_key::text, 0)
  );
  select * into v_existing
  from public.layaway_cancellations
  where operation_key = p_operation_key;
  if found then
    if v_existing.actor_user_id <> v_actor
       or v_existing.request_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'layaway_id', v_existing.layaway_id,
      'refund_cents', v_existing.refund_cents,
      'penalty_cents', v_existing.penalty_cents,
      'released_balance_cents', v_existing.cancelled_balance_cents,
      'refunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'method_code', r.method_code,
          'amount_cents', r.amount_cents,
          'reference', r.reference
        ) order by pm.sort_order, r.id)
        from public.layaway_cancellation_refunds r
        join public.payment_methods pm on pm.code = r.method_code
        where r.cancellation_id = v_existing.id
      ), '[]'::jsonb)
    );
  end if;

  select * into v_session
  from public.cash_sessions
  where id = p_cash_session_id and status = 'OPEN'
  for update;
  if not found or v_session.cashier_user_id <> v_actor
     or not (select app.can_access_location(v_session.location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('layaway:' || p_layaway_id::text, 0)
  );
  select * into v_layaway
  from public.layaways
  where id = p_layaway_id
  for update;
  if not found or v_layaway.location_id <> v_session.location_id then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_layaway.status not in ('OPEN', 'PARTIALLY_PAID', 'PAID') then
    raise exception 'LAYAWAY_NOT_CANCELLABLE' using errcode = '23514';
  end if;
  if v_layaway.due_date < current_date then
    raise exception 'LAYAWAY_ALREADY_OVERDUE' using errcode = '23514';
  end if;
  if p_refund_cents > v_layaway.paid_cents then
    raise exception 'REFUND_EXCEEDS_LAYAWAY_PAYMENTS' using errcode = '23514';
  end if;
  if p_refund_cents = 0
     and jsonb_array_length(coalesce(p_refund_references, '[]'::jsonb)) > 0 then
    raise exception 'UNEXPECTED_REFUND_REFERENCE' using errcode = '22023';
  end if;

  select coalesce(sum(pp.amount_cents), 0)::bigint
  into v_payment_total
  from public.layaway_payments lp
  join public.layaway_payment_parts pp on pp.layaway_payment_id = lp.id
  where lp.layaway_id = v_layaway.id;
  if v_payment_total <> v_layaway.paid_cents then
    raise exception 'LAYAWAY_PAYMENT_TOTAL_MISMATCH' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_refund_references, '[]'::jsonb))
      x(method_code text, reference text)
    left join public.payment_methods pm
      on pm.code = upper(x.method_code)
    where pm.code is null or not pm.requires_reference
       or not exists (
         select 1
         from public.layaway_payments lp
         join public.layaway_payment_parts pp
           on pp.layaway_payment_id = lp.id
         where lp.layaway_id = v_layaway.id
           and pp.method_code = pm.code
       )
  ) then
    raise exception 'UNEXPECTED_REFUND_REFERENCE' using errcode = '22023';
  end if;

  -- Se reparte proporcionalmente entre los métodos realmente recibidos. El
  -- residuo de centavos sigue el orden estable de métodos, igual que M5.
  for v_refund in
    with paid as (
      select pp.method_code, pm.kind, pm.requires_reference, pm.sort_order,
        sum(pp.amount_cents)::bigint as paid_cents
      from public.layaway_payments lp
      join public.layaway_payment_parts pp on pp.layaway_payment_id = lp.id
      join public.payment_methods pm on pm.code = pp.method_code
      where lp.layaway_id = v_layaway.id
      group by pp.method_code, pm.kind, pm.requires_reference, pm.sort_order
    ), shares as (
      select *,
        floor(paid_cents::numeric * p_refund_cents
          / nullif(sum(paid_cents) over (), 0))::bigint as base,
        (paid_cents::numeric * p_refund_cents
          / nullif(sum(paid_cents) over (), 0))
          - floor(paid_cents::numeric * p_refund_cents
            / nullif(sum(paid_cents) over (), 0)) as fraction
      from paid
      where paid_cents > 0 and p_refund_cents > 0
    ), ranked as (
      select *,
        row_number() over (order by fraction desc, sort_order, method_code) rn,
        p_refund_cents - sum(base) over () as remainder
      from shares
    )
    select method_code, kind, requires_reference, sort_order,
      base + case when rn <= remainder then 1 else 0 end as amount_cents
    from ranked
    where base + case when rn <= remainder then 1 else 0 end > 0
    order by sort_order, method_code
  loop
    v_reference := null;
    if v_refund.requires_reference then
      select nullif(btrim(x.reference), '') into v_reference
      from jsonb_to_recordset(coalesce(p_refund_references, '[]'::jsonb))
        x(method_code text, reference text)
      where upper(x.method_code) = v_refund.method_code;
      if length(coalesce(v_reference, '')) < 3 then
        raise exception 'REFUND_REFERENCE_REQUIRED' using errcode = '22023';
      end if;
    end if;
    if v_refund.kind = 'CASH' then
      v_cash_refund := v_cash_refund + v_refund.amount_cents;
    end if;
  end loop;

  perform pg_advisory_xact_lock(
    hashtextextended('layaway-stock:' || li.variant_id::text, 0)
  )
  from public.layaway_items li
  where li.layaway_id = v_layaway.id
  order by li.variant_id;

  for v_item in
    select li.variant_id, li.quantity
    from public.layaway_items li
    where li.layaway_id = v_layaway.id
    order by li.variant_id
  loop
    perform set_config('app.inventory_write', 'on', true);
    update public.inventory_by_location
    set reserved_qty = reserved_qty - v_item.quantity,
      updated_at = now()
    where variant_id = v_item.variant_id
      and location_id = v_layaway.location_id
      and reserved_qty >= v_item.quantity
    returning reserved_qty + v_item.quantity, reserved_qty
    into v_previous_reserved, v_new_reserved;
    get diagnostics v_updated = row_count;
    perform set_config('app.inventory_write', 'off', true);
    if v_updated = 0 then
      raise exception 'RESERVATION_BALANCE_MISMATCH' using errcode = '23514';
    end if;

    perform set_config('app.layaway_write', 'on', true);
    insert into public.inventory_reservation_movements(
      variant_id, location_id, movement_type, quantity,
      previous_reserved_qty, new_reserved_qty, reference_type,
      reference_id, operation_key, user_id, metadata
    ) values (
      v_item.variant_id, v_layaway.location_id, 'RELEASE', -v_item.quantity,
      v_previous_reserved, v_new_reserved, 'LAYAWAY_CANCELLATION',
      v_layaway.id::text, p_operation_key, v_actor,
      jsonb_build_object(
        'folio', v_layaway.folio,
        'reason', btrim(p_reason),
        'refund_cents', p_refund_cents
      )
    );
    perform set_config('app.layaway_write', 'off', true);
  end loop;

  v_previous_status := v_layaway.status;
  perform set_config('app.layaway_write', 'on', true);
  insert into public.layaway_cancellations(
    layaway_id, cash_session_id, location_id, actor_user_id,
    paid_cents, refund_cents, penalty_cents, cancelled_balance_cents,
    reason, operation_key, request_hash
  ) values (
    v_layaway.id, v_session.id, v_layaway.location_id, v_actor,
    v_layaway.paid_cents, p_refund_cents,
    v_layaway.paid_cents - p_refund_cents, v_layaway.balance_cents,
    btrim(p_reason), p_operation_key, v_hash
  ) returning * into v_cancellation;

  with paid as (
    select pp.method_code, pm.sort_order,
      sum(pp.amount_cents)::bigint as paid_cents
    from public.layaway_payments lp
    join public.layaway_payment_parts pp on pp.layaway_payment_id = lp.id
    join public.payment_methods pm on pm.code = pp.method_code
    where lp.layaway_id = v_layaway.id
    group by pp.method_code, pm.sort_order
  ), shares as (
    select *,
      floor(paid_cents::numeric * p_refund_cents
        / nullif(sum(paid_cents) over (), 0))::bigint as base,
      (paid_cents::numeric * p_refund_cents
        / nullif(sum(paid_cents) over (), 0))
        - floor(paid_cents::numeric * p_refund_cents
          / nullif(sum(paid_cents) over (), 0)) as fraction
    from paid
    where paid_cents > 0 and p_refund_cents > 0
  ), ranked as (
    select *,
      row_number() over (order by fraction desc, sort_order, method_code) rn,
      p_refund_cents - sum(base) over () as remainder
    from shares
  )
  insert into public.layaway_cancellation_refunds(
    cancellation_id, method_code, amount_cents, reference
  )
  select v_cancellation.id, r.method_code,
    r.base + case when r.rn <= r.remainder then 1 else 0 end,
    (select nullif(btrim(x.reference), '')
     from jsonb_to_recordset(coalesce(p_refund_references, '[]'::jsonb))
       x(method_code text, reference text)
     where upper(x.method_code) = r.method_code)
  from ranked r
  where r.base + case when r.rn <= r.remainder then 1 else 0 end > 0;

  update public.layaways set
    status = 'CANCELLED',
    cancelled_at = now(),
    cancelled_by = v_actor,
    cancellation_reason = btrim(p_reason),
    cancellation_penalty_cents = paid_cents - p_refund_cents,
    cancellation_refund_cents = p_refund_cents,
    cancelled_balance_cents = balance_cents,
    cancellation_operation_key = p_operation_key,
    updated_at = now()
  where id = v_layaway.id;
  perform set_config('app.layaway_write', 'off', true);

  if v_cash_refund > 0 then
    perform set_config('app.cash_write', 'on', true);
    insert into public.cash_movements(
      session_id, location_id, movement_type, amount_cents,
      reason, reference_type, reference_id, user_id, metadata
    ) values (
      v_session.id, v_layaway.location_id, 'RETURN', -v_cash_refund,
      btrim(p_reason), 'LAYAWAY_CANCELLATION', v_cancellation.id::text,
      v_actor, jsonb_build_object(
        'layaway_id', v_layaway.id,
        'layaway_folio', v_layaway.folio,
        'refund_cents', p_refund_cents
      )
    );
    perform set_config('app.cash_write', 'off', true);
  end if;

  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'layaway.cancelled_active', 'layaways', v_layaway.id::text,
    v_layaway.location_id,
    jsonb_build_object(
      'status', v_previous_status,
      'paid_cents', v_layaway.paid_cents,
      'balance_cents', v_layaway.balance_cents
    ),
    jsonb_build_object(
      'status', 'CANCELLED',
      'refund_cents', p_refund_cents,
      'penalty_cents', v_layaway.paid_cents - p_refund_cents,
      'released_balance_cents', v_layaway.balance_cents
    ),
    jsonb_build_object(
      'folio', v_layaway.folio,
      'reason', btrim(p_reason),
      'cancellation_id', v_cancellation.id,
      'same_method_refund', p_refund_cents > 0
    )
  );

  return jsonb_build_object(
    'id', v_cancellation.id,
    'layaway_id', v_layaway.id,
    'folio', v_layaway.folio,
    'refund_cents', v_cancellation.refund_cents,
    'penalty_cents', v_cancellation.penalty_cents,
    'released_balance_cents', v_cancellation.cancelled_balance_cents,
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'method_code', r.method_code,
        'amount_cents', r.amount_cents,
        'reference', r.reference
      ) order by pm.sort_order, r.id)
      from public.layaway_cancellation_refunds r
      join public.payment_methods pm on pm.code = r.method_code
      where r.cancellation_id = v_cancellation.id
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.layaway_cancellations enable row level security;
alter table public.layaway_cancellation_refunds enable row level security;

create policy layaway_cancellations_rpc_only
on public.layaway_cancellations
for all to authenticated using (false) with check (false);

create policy layaway_cancellation_refunds_rpc_only
on public.layaway_cancellation_refunds
for all to authenticated using (false) with check (false);

revoke all on public.layaway_cancellations,
  public.layaway_cancellation_refunds
from public, anon, authenticated, service_role;

grant select, insert, update, delete on public.layaway_cancellations,
  public.layaway_cancellation_refunds
to service_role;

revoke execute on function public.cancel_active_layaway(
  uuid, uuid, uuid, bigint, jsonb, text
) from public, anon;

grant execute on function public.cancel_active_layaway(
  uuid, uuid, uuid, bigint, jsonb, text
) to authenticated, service_role;

comment on table public.layaway_cancellations is
  'Documento inmutable de cancelación anticipada. Separa devolución, penalización y saldo cancelado sin editar los abonos originales.';

comment on function public.cancel_active_layaway(
  uuid, uuid, uuid, bigint, jsonb, text
) is
  'Cancela un apartado no vencido con permiso de gerente, devuelve hasta lo pagado por los métodos originales y libera la reserva de forma atómica.';

commit;
