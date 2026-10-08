begin;
-- Preparation only: no active USD payment method until checkout, both cash
-- ledgers, blind close, cancellation and MXN refunds are accepted together.
create table public.fx_rate_observations (
 id uuid primary key default extensions.gen_random_uuid(),
 series text not null default 'SF43718' check(series='SF43718'),
 reference_date date not null unique,
 rate_million bigint not null check(rate_million between 1 and 1000000000),
 fetched_at timestamptz not null default clock_timestamp(),
 check(reference_date>='2000-01-01'::date)
);
create table public.fx_rate_adjustments (
 id uuid primary key default extensions.gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 adjustment_million bigint not null check(adjustment_million between -1000000000 and 1000000000),
 actor_user_id uuid not null references public.app_users(id),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default clock_timestamp()
);
create index fx_adjustments_location_created_idx on public.fx_rate_adjustments(location_id,created_at desc,id desc);
create table public.usd_exchange_quotes (
 id uuid primary key default extensions.gen_random_uuid(),
 actor_user_id uuid not null references public.app_users(id),
 cash_session_id uuid not null references public.cash_sessions(id),
 location_id uuid not null references public.locations(id),
 reference_id uuid not null references public.fx_rate_observations(id),
 adjustment_id uuid references public.fx_rate_adjustments(id),
 rate_million bigint not null check(rate_million between 1 and 1000000000),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '5 minutes',
 refund_currency text not null default 'MXN' check(refund_currency='MXN'),
 refund_rate text not null default 'ORIGINAL_SALE' check(refund_rate='ORIGINAL_SALE')
);
create index usd_quotes_session_created_idx on public.usd_exchange_quotes(cash_session_id,created_at desc);
alter table public.fx_rate_observations enable row level security;
alter table public.fx_rate_adjustments enable row level security;
alter table public.usd_exchange_quotes enable row level security;
revoke all on public.fx_rate_observations,public.fx_rate_adjustments,public.usd_exchange_quotes from public,anon,authenticated,service_role;

create function app.guard_fx_document() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'FX_DOCUMENT_IMMUTABLE' using errcode='42501'; end;
$$;
create trigger fx_observation_immutable before update or delete on public.fx_rate_observations for each row execute function app.guard_fx_document();
create trigger fx_adjustment_immutable before update or delete on public.fx_rate_adjustments for each row execute function app.guard_fx_document();
create trigger fx_quote_immutable before update or delete on public.usd_exchange_quotes for each row execute function app.guard_fx_document();
revoke all on function app.guard_fx_document() from public,anon,authenticated,service_role;

create function public.record_banxico_fix(p_date date,p_rate_million bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_rate bigint;
begin
 if p_date is null or p_date<'2000-01-01'::date or p_date>(clock_timestamp() at time zone 'America/Mexico_City')::date
 or p_rate_million is null or p_rate_million not between 1 and 1000000000 then
  raise exception 'INVALID_BANXICO_REFERENCE' using errcode='22023'; end if;
 insert into public.fx_rate_observations(reference_date,rate_million) values(p_date,p_rate_million)
 on conflict(reference_date) do nothing returning id into v_id;
 if v_id is null then
  select id,rate_million into v_id,v_rate from public.fx_rate_observations where reference_date=p_date;
  if v_rate<>p_rate_million then raise exception 'BANXICO_REFERENCE_CONFLICT' using errcode='22023'; end if;
 end if;
 return v_id;
end;$$;
revoke all on function public.record_banxico_fix(date,bigint) from public,anon,authenticated;
grant execute on function public.record_banxico_fix(date,bigint) to service_role;

insert into public.permissions(code,category,description) values('fx.configure','Caja','Autorizar ajuste comercial sobre referencia FIX USD');
insert into public.role_permissions(role_id,permission_code) select id,'fx.configure' from public.roles where code in ('ADMIN','MANAGER');
create function public.set_usd_exchange_adjustment(p_location_id uuid,p_adjustment_million bigint,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app.current_user_id(); v_id uuid; v_reference bigint;
begin
 if v_actor is null or not app.has_perm('fx.configure') or not app.can_access_location(p_location_id) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_adjustment_million is null or p_adjustment_million not between -1000000000 and 1000000000 or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
  raise exception 'INVALID_FX_ADJUSTMENT' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fx-adjustment:'||p_location_id::text,0));
 select rate_million into v_reference from public.fx_rate_observations order by reference_date desc limit 1;
 if not found then raise exception 'FX_REFERENCE_UNAVAILABLE' using errcode='22023'; end if;
 if v_reference+p_adjustment_million not between 1 and 1000000000 then raise exception 'INVALID_FX_ADJUSTMENT' using errcode='22023'; end if;
 insert into public.fx_rate_adjustments(location_id,adjustment_million,actor_user_id,reason)
 values(p_location_id,p_adjustment_million,v_actor,btrim(p_reason)) returning id into v_id;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,metadata)
 values(v_actor,'fx.adjustment_authorized','fx_rate_adjustments',v_id::text,p_location_id,jsonb_build_object('adjustment_million',p_adjustment_million,'reason',btrim(p_reason)));
 return v_id;
end;$$;
revoke all on function public.set_usd_exchange_adjustment(uuid,bigint,text) from public,anon,service_role;
grant execute on function public.set_usd_exchange_adjustment(uuid,bigint,text) to authenticated;

create function public.get_usd_exchange_quote(p_cash_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app.current_user_id(); v_session public.cash_sessions; v_reference public.fx_rate_observations;
 v_adjustment public.fx_rate_adjustments; v_quote public.usd_exchange_quotes; v_million bigint;
begin
 if v_actor is null or not app.has_perm('pos.sell') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select * into v_session from public.cash_sessions where id=p_cash_session_id;
 if not found or v_session.status<>'OPEN' or v_session.cashier_user_id<>v_actor or not app.can_access_location(v_session.location_id) then
  raise exception 'CASH_SESSION_FORBIDDEN' using errcode='42501'; end if;
 select * into v_reference from public.fx_rate_observations order by reference_date desc limit 1;
 if not found then raise exception 'FX_REFERENCE_UNAVAILABLE' using errcode='22023'; end if;
 select * into v_adjustment from public.fx_rate_adjustments where location_id=v_session.location_id order by created_at desc,id desc limit 1;
 v_million:=v_reference.rate_million+coalesce(v_adjustment.adjustment_million,0);
 if v_million not between 1 and 1000000000 then raise exception 'INVALID_FX_ADJUSTMENT' using errcode='22023'; end if;
 insert into public.usd_exchange_quotes(actor_user_id,cash_session_id,location_id,reference_id,adjustment_id,rate_million)
 values(v_actor,v_session.id,v_session.location_id,v_reference.id,v_adjustment.id,v_million) returning * into v_quote;
 return jsonb_build_object('id',v_quote.id,'reference_date',v_reference.reference_date,
 'reference_rate_million',v_reference.rate_million,'adjustment_million',coalesce(v_adjustment.adjustment_million,0),
 'rate_million',v_quote.rate_million,'expires_at',v_quote.expires_at,'refund_currency','MXN','refund_rate','ORIGINAL_SALE');
end;$$;
revoke all on function public.get_usd_exchange_quote(uuid) from public,anon,service_role;
grant execute on function public.get_usd_exchange_quote(uuid) to authenticated;
commit;
