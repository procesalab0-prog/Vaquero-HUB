begin;
-- Closed preparation, NOT an enabled payment feature. The private engine is
-- tested in isolated QA only. Enablement requires refunds, blind USD close,
-- receipt/UI and real Auth/PostgREST acceptance in a later migration.
create table app.usd_checkout_gate (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into app.usd_checkout_gate(singleton,enabled) values(true,false);
alter table app.usd_checkout_gate enable row level security;
revoke all on app.usd_checkout_gate from public,anon,authenticated,service_role;
insert into public.payment_methods(code,name,kind,requires_reference,is_active,sort_order)
values('USD','Dólares en efectivo','OTHER',false,false,90);
insert into public.cash_movement_types(code,description)
values('USD_CHANGE','Cambio entregado en pesos por cobro en dólares');

create table public.usd_sale_tenders (
 id uuid primary key default extensions.gen_random_uuid(),
 sale_id uuid not null unique references public.sales(id),
 quote_id uuid not null unique references public.usd_exchange_quotes(id),
 idempotency_key uuid not null unique,
 request_hash text not null,
 cash_session_id uuid not null references public.cash_sessions(id),
 actor_user_id uuid not null references public.app_users(id),
 received_usd_cents bigint not null check(received_usd_cents between 1 and 9007199254740991),
 rate_million bigint not null check(rate_million between 1 and 1000000000),
 equivalent_mxn_cents bigint not null check(equivalent_mxn_cents between 1 and 9007199254740991),
 applied_mxn_cents bigint not null check(applied_mxn_cents>0),
 change_mxn_cents bigint not null check(change_mxn_cents>=0),
 refund_currency text not null default 'MXN' check(refund_currency='MXN'),
 refund_rate text not null default 'ORIGINAL_SALE' check(refund_rate='ORIGINAL_SALE'),
 created_at timestamptz not null default clock_timestamp(),
 check(equivalent_mxn_cents=round(received_usd_cents::numeric*rate_million/1000000)),
 check(equivalent_mxn_cents=applied_mxn_cents+change_mxn_cents)
);
create index usd_tenders_session_idx on public.usd_sale_tenders(cash_session_id,created_at);
create table public.usd_cash_movements (
 id uuid primary key default extensions.gen_random_uuid(),
 tender_id uuid not null unique references public.usd_sale_tenders(id),
 session_id uuid not null references public.cash_sessions(id),
 amount_usd_cents bigint not null check(amount_usd_cents>0),
 user_id uuid not null references public.app_users(id),
 created_at timestamptz not null default clock_timestamp()
);
create index usd_cash_session_idx on public.usd_cash_movements(session_id,created_at);
alter table public.usd_sale_tenders enable row level security;
alter table public.usd_cash_movements enable row level security;
revoke all on public.usd_sale_tenders,public.usd_cash_movements from public,anon,authenticated,service_role;
create trigger usd_tender_immutable before update or delete on public.usd_sale_tenders
for each row execute function app.guard_fx_document();
create trigger usd_cash_immutable before update or delete on public.usd_cash_movements
for each row execute function app.guard_fx_document();

create function app.guard_usd_cash_insert() returns trigger language plpgsql set search_path='' as $$
declare v_tender public.usd_sale_tenders; v_session public.cash_sessions;
begin
 select * into v_tender from public.usd_sale_tenders where id=new.tender_id;
 if not found or new.session_id<>v_tender.cash_session_id or new.user_id<>v_tender.actor_user_id
 or new.amount_usd_cents<>v_tender.received_usd_cents then
  raise exception 'USD_LEDGER_MISMATCH' using errcode='23514'; end if;
 select * into v_session from public.cash_sessions where id=new.session_id for update;
 if not found or v_session.status<>'OPEN' or v_session.cashier_user_id<>new.user_id then
  raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
 return new;
end;$$;
create trigger usd_cash_validate before insert on public.usd_cash_movements
for each row execute function app.guard_usd_cash_insert();

-- A direct call to the normal sale engine cannot bypass the foreign ledger.
-- The invariant is checked at COMMIT, after all three documents exist.
-- Deferred triggers execute after the calling RPC has returned. This closed
-- trigger needs definer access to its private ledgers; it returns no data.
create function app.check_usd_sale_balance() returns trigger language plpgsql security definer set search_path='' as $$
declare v_sale uuid; v_t public.usd_sale_tenders; v_q public.usd_exchange_quotes;
 v_s public.sales; v_paid bigint; v_change bigint; v_usd bigint;
begin
 if tg_table_name='sale_payments' then
  if new.method_code<>'USD' then return new; end if; v_sale:=new.sale_id;
 elsif tg_table_name='usd_cash_movements' then
  select sale_id into v_sale from public.usd_sale_tenders where id=new.tender_id;
 else v_sale:=new.sale_id; end if;
 select * into v_t from public.usd_sale_tenders where sale_id=v_sale;
 if not found then raise exception 'USD_TENDER_REQUIRED' using errcode='23514'; end if;
 select * into v_q from public.usd_exchange_quotes where id=v_t.quote_id;
 select * into v_s from public.sales where id=v_sale;
 select coalesce(sum(amount_cents),0) into v_paid from public.sale_payments where sale_id=v_sale and method_code='USD';
 select coalesce(sum(amount_usd_cents),0) into v_usd from public.usd_cash_movements where tender_id=v_t.id;
 select coalesce(-sum(amount_cents),0) into v_change from public.cash_movements
 where reference_type='USD_TENDER' and reference_id=v_t.id::text and movement_type='USD_CHANGE';
 if v_s.cash_session_id<>v_t.cash_session_id or v_s.cashier_user_id<>v_t.actor_user_id
 or v_q.cash_session_id<>v_t.cash_session_id or v_q.actor_user_id<>v_t.actor_user_id or v_q.location_id<>v_s.location_id
 or v_q.rate_million<>v_t.rate_million or v_paid<>v_t.applied_mxn_cents
 or v_usd<>v_t.received_usd_cents or v_change<>v_t.change_mxn_cents then
  raise exception 'USD_LEDGER_MISMATCH' using errcode='23514'; end if;
 return new;
end;$$;
create constraint trigger usd_payment_balance after insert on public.sale_payments
deferrable initially deferred for each row execute function app.check_usd_sale_balance();
create constraint trigger usd_tender_balance after insert on public.usd_sale_tenders
deferrable initially deferred for each row execute function app.check_usd_sale_balance();
create constraint trigger usd_cash_balance after insert on public.usd_cash_movements
deferrable initially deferred for each row execute function app.check_usd_sale_balance();

create function app.guard_usd_change() returns trigger language plpgsql set search_path='' as $$
declare v_t public.usd_sale_tenders; v_available bigint;
begin
 if new.movement_type<>'USD_CHANGE' then return new; end if;
 select * into v_t from public.usd_sale_tenders where id::text=new.reference_id;
 if not found or new.reference_type<>'USD_TENDER' or new.session_id<>v_t.cash_session_id
 or new.user_id<>v_t.actor_user_id or new.amount_cents<>-v_t.change_mxn_cents
 or new.amount_cents>=0 then raise exception 'USD_LEDGER_MISMATCH' using errcode='23514'; end if;
 perform 1 from public.cash_sessions where id=new.session_id and status='OPEN' for update;
 if not found then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
 select coalesce(sum(amount_cents),0) into v_available from public.cash_movements where session_id=new.session_id;
 if -new.amount_cents>v_available then raise exception 'INSUFFICIENT_CASH' using errcode='P0001'; end if;
 return new;
end;$$;
create trigger usd_change_validate before insert on public.cash_movements
for each row execute function app.guard_usd_change();
create unique index usd_change_tender_idx on public.cash_movements(reference_id)
where movement_type='USD_CHANGE';

-- Fail closed: neither legacy close nor refunds/cancellations can silently
-- ignore USD while their dedicated integration is unfinished. No normal sale
-- has an USD tender, so existing production operations are unaffected.
create function app.guard_pending_usd_lifecycle() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='cash_sessions' then
  if new.status='CLOSED' and old.status='OPEN' and exists(select 1 from public.usd_cash_movements where session_id=new.id) then
   raise exception 'USD_CLOSE_NOT_ENABLED' using errcode='42501'; end if;
 elsif tg_table_name='returns' then
  if exists(select 1 from public.usd_sale_tenders where sale_id=new.original_sale_id) then
   raise exception 'USD_REFUND_NOT_ENABLED' using errcode='42501'; end if;
 else
  if exists(select 1 from public.usd_sale_tenders where sale_id=new.id) and new.status is distinct from old.status then
   raise exception 'USD_REFUND_NOT_ENABLED' using errcode='42501'; end if;
 end if;
 return new;
end;$$;
create trigger usd_close_pending before update on public.cash_sessions
for each row execute function app.guard_pending_usd_lifecycle();
create trigger usd_refund_pending before update on public.sales
for each row execute function app.guard_pending_usd_lifecycle();
create trigger usd_return_pending before insert on public.returns
for each row execute function app.guard_pending_usd_lifecycle();

create function app.create_usd_sale(
 p_idempotency_key uuid,p_cash_session_id uuid,p_items jsonb,p_quote_id uuid,
 p_received_usd_cents bigint,p_applied_mxn_cents bigint,p_other_payments jsonb default '[]'::jsonb,
 p_customer_id uuid default null,p_discounts jsonb default '[]'::jsonb,p_notes text default null
) returns public.sales language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app.current_user_id(); v_quote public.usd_exchange_quotes;
 v_session public.cash_sessions; v_sale public.sales; v_t public.usd_sale_tenders;
 v_hash text; v_equivalent numeric; v_change bigint; v_payments jsonb;
begin
 if v_actor is null or not app.has_perm('pos.sell') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if not exists(select 1 from app.usd_checkout_gate where singleton and enabled) then
  raise exception 'USD_CHECKOUT_NOT_ENABLED' using errcode='42501'; end if;
 if p_idempotency_key is null or p_quote_id is null or p_received_usd_cents is null
 or p_received_usd_cents not between 1 and 9007199254740991 or p_applied_mxn_cents is null
 or p_applied_mxn_cents not between 1 and 9007199254740991
 or jsonb_typeof(p_other_payments) is distinct from 'array' or jsonb_array_length(p_other_payments)>9 then
  raise exception 'INVALID_USD_PAYMENT' using errcode='22023'; end if;
 -- Only tested ordinary methods may be mixed here. Credit, layaway and
 -- loyalty keep their dedicated authorization/lifecycle entry points.
 if exists(select 1 from jsonb_array_elements(p_other_payments) p where
  coalesce(upper(p->>'method_code'),'') not in ('CASH','CARD','TRANSFER')) then
  raise exception 'INVALID_USD_PAYMENT' using errcode='22023'; end if;
 v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('session',p_cash_session_id,'items',p_items,
 'quote',p_quote_id,'usd',p_received_usd_cents,'applied',p_applied_mxn_cents,'other',p_other_payments,
 'customer',p_customer_id,'discounts',p_discounts,'notes',p_notes)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('create_sale:'||p_idempotency_key::text,0));
 select * into v_t from public.usd_sale_tenders where idempotency_key=p_idempotency_key;
 if found then
  if v_t.actor_user_id<>v_actor or v_t.request_hash<>v_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
  select * into strict v_sale from public.sales where id=v_t.sale_id; return v_sale;
 end if;
 select * into v_quote from public.usd_exchange_quotes where id=p_quote_id for update;
 if not found or v_quote.actor_user_id<>v_actor or v_quote.cash_session_id<>p_cash_session_id then
  raise exception 'FX_QUOTE_FORBIDDEN' using errcode='42501'; end if;
 if v_quote.expires_at<=clock_timestamp() then raise exception 'FX_QUOTE_EXPIRED' using errcode='22023'; end if;
 if exists(select 1 from public.usd_sale_tenders where quote_id=p_quote_id) then
  raise exception 'FX_QUOTE_ALREADY_USED' using errcode='22023'; end if;
 select * into v_session from public.cash_sessions where id=p_cash_session_id for update;
 if not found or v_session.status<>'OPEN' or v_session.cashier_user_id<>v_actor
 or not app.can_access_location(v_session.location_id) then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
 v_equivalent:=round(p_received_usd_cents::numeric*v_quote.rate_million/1000000);
 if v_equivalent>9007199254740991 or v_equivalent<p_applied_mxn_cents then
  raise exception 'INSUFFICIENT_USD_TENDERED' using errcode='22023'; end if;
 v_change:=v_equivalent::bigint-p_applied_mxn_cents;
 v_payments:=p_other_payments||jsonb_build_array(jsonb_build_object('method_code','USD','amount_cents',p_applied_mxn_cents,
 'reference',p_quote_id::text||':'||p_received_usd_cents::text));
 -- Same engine, same stock/price/discount/idempotency protections as normal POS.
 v_sale:=public.create_sale(p_idempotency_key,p_cash_session_id,p_items,v_payments,p_customer_id,p_discounts,p_notes);
 insert into public.usd_sale_tenders(sale_id,quote_id,idempotency_key,request_hash,cash_session_id,actor_user_id,
 received_usd_cents,rate_million,equivalent_mxn_cents,applied_mxn_cents,change_mxn_cents)
 values(v_sale.id,v_quote.id,p_idempotency_key,v_hash,v_session.id,v_actor,p_received_usd_cents,
 v_quote.rate_million,v_equivalent::bigint,p_applied_mxn_cents,v_change) returning * into v_t;
 insert into public.usd_cash_movements(tender_id,session_id,amount_usd_cents,user_id)
 values(v_t.id,v_session.id,p_received_usd_cents,v_actor);
 if v_change>0 then
  perform set_config('app.cash_write','on',true);
  insert into public.cash_movements(session_id,location_id,movement_type,amount_cents,reference_type,reference_id,user_id)
  values(v_session.id,v_session.location_id,'USD_CHANGE',-v_change,'USD_TENDER',v_t.id::text,v_actor);
  perform set_config('app.cash_write','off',true);
 end if;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,metadata)
 values(v_actor,'sale.usd_received','usd_sale_tenders',v_t.id::text,v_session.location_id,
 jsonb_build_object('sale_id',v_sale.id,'quote_id',v_quote.id,'refund_currency','MXN','refund_rate','ORIGINAL_SALE'));
 return v_sale;
end;$$;
revoke all on function app.create_usd_sale(uuid,uuid,jsonb,uuid,bigint,bigint,jsonb,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function app.guard_usd_cash_insert(),app.check_usd_sale_balance(),app.guard_usd_change(),app.guard_pending_usd_lifecycle()
from public,anon,authenticated,service_role;
commit;
