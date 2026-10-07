begin;
-- Source allocations remain in original MXN cents under method USD. This
-- preserves the existing proportional/partial-return ceiling. The physical
-- refund goes to the MXN cash ledger, never to the USD ledger or today's FIX.
drop trigger usd_return_pending on public.returns;
drop trigger usd_refund_pending on public.sales;
create function app.record_usd_return_in_mxn() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_return public.returns; v_t public.usd_sale_tenders; v_refunded bigint;
begin
 if new.method_code<>'USD' then return new; end if;
 if new.direction<>'REFUND' then raise exception 'USD_RETURN_CHARGE_NOT_SUPPORTED' using errcode='22023'; end if;
 select * into strict v_return from public.returns where id=new.return_id;
 select * into v_t from public.usd_sale_tenders where sale_id=v_return.original_sale_id;
 if not found then raise exception 'USD_TENDER_REQUIRED' using errcode='23514'; end if;
 select coalesce(sum(rp.amount_cents),0) into v_refunded
 from public.return_payments rp join public.returns r on r.id=rp.return_id
 where r.original_sale_id=v_t.sale_id and rp.method_code='USD' and rp.direction='REFUND';
 if v_refunded>v_t.applied_mxn_cents then raise exception 'REFUND_EXCEEDS_ORIGINAL_PAYMENT' using errcode='22023'; end if;
 perform set_config('app.cash_write','on',true);
 insert into public.cash_movements(session_id,location_id,movement_type,amount_cents,reason,reference_type,reference_id,user_id,metadata)
 values(v_return.cash_session_id,v_return.location_id,'RETURN',-new.amount_cents,v_return.reason,
 'USD_RETURN_PAYMENT',new.id::text,v_return.created_by,
 jsonb_build_object('original_sale_id',v_t.sale_id,'source_method','USD','refund_currency','MXN',
 'rate_million',v_t.rate_million,'usd_tender_id',v_t.id));
 perform set_config('app.cash_write','off',true);
 return new;
end;$$;
create trigger usd_refund_mxn after insert on public.return_payments
for each row execute function app.record_usd_return_in_mxn();
create unique index usd_return_payment_cash_idx on public.cash_movements(reference_id)
where reference_type='USD_RETURN_PAYMENT';

create function app.record_usd_cancellation_in_mxn() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_t public.usd_sale_tenders;
begin
 if new.status<>'CANCELLED' or old.status='CANCELLED' then return new; end if;
 select * into v_t from public.usd_sale_tenders where sale_id=new.id;
 if not found then return new; end if;
 perform 1 from public.cash_sessions where id=new.cash_session_id and status='OPEN' for update;
 if not found then raise exception 'SALE_SESSION_CLOSED' using errcode='22023'; end if;
 if exists(select 1 from public.returns where original_sale_id=new.id) then
  raise exception 'SALE_HAS_RETURNS' using errcode='22023'; end if;
 perform set_config('app.cash_write','on',true);
 insert into public.cash_movements(session_id,location_id,movement_type,amount_cents,reason,reference_type,reference_id,user_id,metadata)
 values(new.cash_session_id,new.location_id,'RETURN',-v_t.applied_mxn_cents,
 'Cancelación: reembolso USD en pesos','USD_CANCELLATION',new.id::text,app.current_user_id(),
 jsonb_build_object('source_method','USD','refund_currency','MXN','rate_million',v_t.rate_million,'usd_tender_id',v_t.id));
 perform set_config('app.cash_write','off',true);
 return new;
end;$$;
create trigger usd_cancellation_mxn after update of status on public.sales
for each row execute function app.record_usd_cancellation_in_mxn();
create unique index usd_cancellation_cash_idx on public.cash_movements(reference_id)
where reference_type='USD_CANCELLATION';

-- USD cannot be used as an unbacked OTHER payment in modules which have no
-- foreign-tender flow. Their existing ordinary methods remain unchanged.
create function app.reject_unbacked_usd_part() returns trigger language plpgsql set search_path='' as $$
begin if new.method_code='USD' then raise exception 'USD_METHOD_NOT_SUPPORTED_HERE' using errcode='22023'; end if; return new; end;$$;
create trigger credit_no_unbacked_usd before insert on public.customer_credit_payment_parts
for each row execute function app.reject_unbacked_usd_part();
create trigger layaway_no_unbacked_usd before insert on public.layaway_payment_parts
for each row execute function app.reject_unbacked_usd_part();

create function public.create_usd_sale(
 p_idempotency_key uuid,p_cash_session_id uuid,p_items jsonb,p_quote_id uuid,
 p_received_usd_cents bigint,p_applied_mxn_cents bigint,p_other_payments jsonb default '[]'::jsonb,
 p_customer_id uuid default null,p_discounts jsonb default '[]'::jsonb,p_notes text default null
) returns public.sales language sql security definer set search_path='' as $$
 select app.create_usd_sale(p_idempotency_key,p_cash_session_id,p_items,p_quote_id,p_received_usd_cents,
 p_applied_mxn_cents,p_other_payments,p_customer_id,p_discounts,p_notes);
$$;
create function public.close_cash_session_with_usd(p_session_id uuid,p_counted_mxn_cents bigint,p_counted_usd_cents bigint,p_difference_reason text default null)
returns jsonb language sql security definer set search_path='' as $$
 select app.close_cash_session_with_usd(p_session_id,p_counted_mxn_cents,p_counted_usd_cents,p_difference_reason);
$$;
create function public.get_sale_usd_tender(p_sale_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_authorized jsonb; v_result jsonb;
begin
 -- Reuse the existing receipt's live actor/location/ownership checks.
 v_authorized:=public.get_sale_receipt(p_sale_id);
 if v_authorized is null then raise exception 'SALE_NOT_FOUND' using errcode='22023'; end if;
 select jsonb_build_object('received_usd_cents',t.received_usd_cents,'rate_million',t.rate_million,
 'equivalent_mxn_cents',t.equivalent_mxn_cents,'applied_mxn_cents',t.applied_mxn_cents,
 'change_mxn_cents',t.change_mxn_cents,'reference_date',r.reference_date,'refund_currency','MXN')
 into v_result from public.usd_sale_tenders t join public.usd_exchange_quotes q on q.id=t.quote_id
 join public.fx_rate_observations r on r.id=q.reference_id where t.sale_id=p_sale_id;
 return v_result;
end;$$;
revoke all on function public.create_usd_sale(uuid,uuid,jsonb,uuid,bigint,bigint,jsonb,uuid,jsonb,text),
 public.close_cash_session_with_usd(uuid,bigint,bigint,text),public.get_sale_usd_tender(uuid)
from public,anon,service_role;
grant execute on function public.create_usd_sale(uuid,uuid,jsonb,uuid,bigint,bigint,jsonb,uuid,jsonb,text),
 public.close_cash_session_with_usd(uuid,bigint,bigint,text),public.get_sale_usd_tender(uuid) to authenticated;
revoke all on function app.record_usd_return_in_mxn(),app.record_usd_cancellation_in_mxn(),app.reject_unbacked_usd_part()
from public,anon,authenticated,service_role;
-- No enablement here. Missing FIX token or unaccepted rollout cannot activate
-- the feature simply because a public wrapper now exists.
create function public.usd_checkout_available() returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if app.current_user_id() is null or not app.has_perm('pos.sell') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return exists(select 1 from app.usd_checkout_gate g join public.payment_methods m on m.code='USD' where g.singleton and g.enabled and m.is_active);
end;$$;
revoke all on function public.usd_checkout_available() from public,anon,service_role;
grant execute on function public.usd_checkout_available() to authenticated;
alter function public.get_sale_receipt(uuid) rename to get_sale_receipt_before_usd;
alter function public.get_sale_receipt_before_usd(uuid) set schema app;
revoke all on function app.get_sale_receipt_before_usd(uuid) from public,anon,authenticated,service_role;
create function public.get_sale_receipt(p_sale_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_receipt jsonb; v_usd jsonb;
begin
 v_receipt:=app.get_sale_receipt_before_usd(p_sale_id);
 select jsonb_build_object('received_usd_cents',t.received_usd_cents,'rate_million',t.rate_million,
 'equivalent_mxn_cents',t.equivalent_mxn_cents,'change_mxn_cents',t.change_mxn_cents,'refund_currency','MXN')
 into v_usd from public.usd_sale_tenders t where t.sale_id=p_sale_id;
 return v_receipt||jsonb_build_object('usd_tender',v_usd);
end;$$;
revoke all on function public.get_sale_receipt(uuid) from public,anon,service_role;
grant execute on function public.get_sale_receipt(uuid) to authenticated;
create function public.preview_cash_close_with_usd(p_session_id uuid,p_counted_mxn_cents bigint,p_counted_usd_cents bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.cash_sessions; v_result jsonb; v_usd bigint;
begin
 if app.current_user_id() is null or not app.has_perm('cash.close') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_counted_usd_cents is null or p_counted_usd_cents not between 0 and 100000000 then raise exception 'INVALID_COUNTED_AMOUNT' using errcode='22023'; end if;
 select * into v_session from public.cash_sessions where id=p_session_id for update;
 if not found or v_session.status<>'OPEN' or v_session.cashier_user_id<>app.current_user_id()
 or not app.can_access_location(v_session.location_id) then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
 v_result:=public.preview_cash_close(p_session_id,p_counted_mxn_cents);
 select coalesce(sum(amount_usd_cents),0) into v_usd from public.usd_cash_movements where session_id=p_session_id;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,metadata)
 values(app.current_user_id(),'cash_session.usd_count_previewed','cash_sessions',p_session_id::text,v_session.location_id,
 jsonb_build_object('counted_usd_cents',p_counted_usd_cents));
 return v_result||jsonb_build_object('usd',jsonb_build_object('expected_cents',v_usd,'counted_cents',p_counted_usd_cents,'difference_cents',p_counted_usd_cents-v_usd));
end;$$;
revoke all on function public.preview_cash_close_with_usd(uuid,bigint,bigint) from public,anon,service_role;
grant execute on function public.preview_cash_close_with_usd(uuid,bigint,bigint) to authenticated;
alter function public.get_my_cash_session() rename to get_my_cash_session_before_usd;
alter function public.get_my_cash_session_before_usd() set schema app;
revoke all on function app.get_my_cash_session_before_usd() from public,anon,authenticated,service_role;
create function public.get_my_cash_session() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_session jsonb;
begin
 v_session:=app.get_my_cash_session_before_usd();
 if v_session is null then return null; end if;
 -- Reveal only the need for a count, never the expected foreign cash balance.
 return v_session||jsonb_build_object('has_usd',exists(select 1 from public.usd_cash_movements where session_id=(v_session->>'id')::uuid));
end;$$;
revoke all on function public.get_my_cash_session() from public,anon,service_role;
grant execute on function public.get_my_cash_session() to authenticated;
commit;
