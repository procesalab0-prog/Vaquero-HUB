begin;
select app.assert_sicar_staging_enabled();
-- Native Woo update_status(processing) may set date_paid without executing a
-- gateway. Preserve that observed date as an explicit REVIEW, never as payment.
do $patch$
declare s text;old_anchor text;new_anchor text;
begin
 s:=pg_get_functiondef('public.m9_record_woo_finance_read(jsonb)'::regprocedure);
 old_anchor:=$s$or s->'payment' is distinct from '{"method":"m9_synthetic_no_payment","transaction_id":"","paid_at":null,"is_paid":false}'::jsonb$s$;
 new_anchor:=$s$or jsonb_typeof(s->'payment') is distinct from 'object'
  or (s->'payment')-'paid_at' is distinct from '{"method":"m9_synthetic_no_payment","transaction_id":"","is_paid":false}'::jsonb
  or not (s->'payment' ? 'paid_at')
  or not ((s#>'{payment,paid_at}')='null'::jsonb or (jsonb_typeof(s#>'{payment,paid_at}')='string' and s#>>'{payment,paid_at}' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$'))$s$;
 if strpos(s,old_anchor)=0 then raise exception 'FINANCE_DATE_GUARD_SOURCE_CHANGED';end if;s:=replace(s,old_anchor,new_anchor);
 old_anchor:=$s$money:=s->'money';line:=s->'lines'->0;$s$;
 new_anchor:=$s$if s#>'{payment,paid_at}'<>'null'::jsonb then
  begin perform (s#>>'{payment,paid_at}')::timestamptz;
  exception when others then raise exception 'FINANCE_SNAPSHOT_CHANGED';end;
 end if;
 money:=s->'money';line:=s->'lines'->0;$s$;
 if strpos(s,old_anchor)=0 then raise exception 'FINANCE_DATE_PARSE_SOURCE_CHANGED';end if;s:=replace(s,old_anchor,new_anchor);
 old_anchor:=$s$'classification','CANCELLED_UNPAID','observed_total_cents',expected,'paid_amount_cents',null,$s$;
 new_anchor:=$s$'classification',case when s#>'{payment,paid_at}'='null'::jsonb then 'CANCELLED_UNPAID' else 'CANCELLED_PAYMENT_DATE_REVIEW' end,
  'payment_date_observed',s#>'{payment,paid_at}','observed_total_cents',expected,'paid_amount_cents',null,$s$;
 if strpos(s,old_anchor)=0 then raise exception 'FINANCE_CLASSIFICATION_SOURCE_CHANGED';end if;
 execute replace(s,old_anchor,new_anchor);
end $patch$;
commit;
