begin;
-- Backend acceptance only. USD checkout stays disabled and this closer has
-- no application EXECUTE grant until the complete financial/UI flow is ready.
create table public.usd_cash_closes (
 session_id uuid primary key references public.cash_sessions(id),
 counted_usd_cents bigint not null check(counted_usd_cents between 0 and 100000000),
 expected_usd_cents bigint not null check(expected_usd_cents>=0),
 difference_usd_cents bigint not null,
 difference_reason text,
 actor_user_id uuid not null references public.app_users(id),
 created_at timestamptz not null default clock_timestamp(),
 check(difference_usd_cents=counted_usd_cents-expected_usd_cents),
 check(difference_usd_cents=0 or length(btrim(coalesce(difference_reason,''))) between 3 and 500)
);
alter table public.usd_cash_closes enable row level security;
revoke all on public.usd_cash_closes from public,anon,authenticated,service_role;
create trigger usd_close_immutable before update or delete on public.usd_cash_closes
for each row execute function app.guard_fx_document();

create function app.guard_usd_close_complete() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_close public.usd_cash_closes; v_expected bigint;
begin
 if old.status<>'OPEN' or new.status<>'CLOSED' then return new; end if;
 select coalesce(sum(amount_usd_cents),0) into v_expected from public.usd_cash_movements where session_id=new.id;
 if v_expected=0 then return new; end if;
 select * into v_close from public.usd_cash_closes where session_id=new.id;
 if not found then raise exception 'USD_COUNT_REQUIRED' using errcode='22023'; end if;
 if v_close.expected_usd_cents<>v_expected or v_close.actor_user_id<>new.cashier_user_id
 or v_close.actor_user_id is distinct from new.closed_by then
  raise exception 'USD_CLOSE_MISMATCH' using errcode='23514'; end if;
 return new;
end;$$;
-- Replace only the close guard; unfinished USD refunds stay independently shut.
drop trigger usd_close_pending on public.cash_sessions;
create trigger usd_close_complete before update on public.cash_sessions
for each row execute function app.guard_usd_close_complete();

create function app.check_usd_close_document() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_session public.cash_sessions; v_expected bigint;
begin
 select * into v_session from public.cash_sessions where id=new.session_id;
 select coalesce(sum(amount_usd_cents),0) into v_expected from public.usd_cash_movements where session_id=new.session_id;
 if v_session.status<>'CLOSED' or v_session.closed_by<>new.actor_user_id
 or v_session.cashier_user_id<>new.actor_user_id or v_expected<>new.expected_usd_cents then
  raise exception 'USD_CLOSE_MISMATCH' using errcode='23514'; end if;
 return new;
end;$$;
create constraint trigger usd_close_document_complete after insert on public.usd_cash_closes
deferrable initially deferred for each row execute function app.check_usd_close_document();

create function app.close_cash_session_with_usd(
 p_session_id uuid,p_counted_mxn_cents bigint,p_counted_usd_cents bigint,
 p_difference_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app.current_user_id(); v_session public.cash_sessions;
 v_expected bigint; v_difference bigint; v_result jsonb; v_reason text:=nullif(btrim(p_difference_reason),'');
begin
 if v_actor is null or not app.has_perm('cash.close') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_counted_usd_cents is null or p_counted_usd_cents not between 0 and 100000000
 or p_counted_mxn_cents is null or p_counted_mxn_cents not between 0 and 100000000
 or length(coalesce(v_reason,''))>500 then raise exception 'INVALID_COUNTED_AMOUNT' using errcode='22023'; end if;
 select * into v_session from public.cash_sessions where id=p_session_id for update;
 if not found or v_session.status<>'OPEN' or v_session.cashier_user_id<>v_actor
 or not app.can_access_location(v_session.location_id) then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
 select coalesce(sum(amount_usd_cents),0) into v_expected from public.usd_cash_movements where session_id=p_session_id;
 v_difference:=p_counted_usd_cents-v_expected;
 if v_difference<>0 and length(coalesce(v_reason,'')) not between 3 and 500 then
  raise exception 'DIFFERENCE_REASON_REQUIRED' using errcode='22023'; end if;
 insert into public.usd_cash_closes(session_id,counted_usd_cents,expected_usd_cents,difference_usd_cents,difference_reason,actor_user_id)
 values(p_session_id,p_counted_usd_cents,v_expected,v_difference,v_reason,v_actor);
 -- Original closer still validates the MXN count, reason, own session and
 -- clears drafts. A failure rolls back BOTH currency documents.
 v_result:=public.close_cash_session(p_session_id,p_counted_mxn_cents,v_reason);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,metadata)
 values(v_actor,'cash_session.usd_closed','usd_cash_closes',p_session_id::text,v_session.location_id,
 jsonb_build_object('currency','USD','counted_usd_cents',p_counted_usd_cents,
 'expected_usd_cents',v_expected,'difference_usd_cents',v_difference,'reason',v_reason));
 -- No expected balance is exposed before submitting both physical counts.
 return v_result||jsonb_build_object('usd',jsonb_build_object('currency','USD',
 'expected_cents',v_expected,'counted_cents',p_counted_usd_cents,'difference_cents',v_difference));
end;$$;
revoke all on function app.close_cash_session_with_usd(uuid,bigint,bigint,text),
 app.guard_usd_close_complete(),app.check_usd_close_document()
from public,anon,authenticated,service_role;
commit;
