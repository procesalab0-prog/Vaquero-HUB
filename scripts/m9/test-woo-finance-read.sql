-- Structural protocol fixtures only; not a live Woo or native financial sale.
begin;
create temporary table finance_test_results(result jsonb) on commit drop;
do $$
declare actor uuid:='2b5e4ba1-00f2-48c7-bbe0-273340629711';tid uuid:='87427c06-b889-41a1-960b-930b1ed8e8df';ctx jsonb;s jsonb;i jsonb;bad jsonb;r jsonb;k text;wanted text;caught boolean;n integer:=0;expected text;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 ctx:=app.m9_woo_finance_context(actor,tid);
 expected:=to_char(((ctx->'reference'->>'quantity')::numeric*(ctx->'reference'->>'unit_price_cents')::numeric)/100,'FM999999999999990.00');
 s:=jsonb_build_object('protocol','m9-remote-order-finance-read-1','reference',ctx->'reference','currency','MXN',
  'money',jsonb_build_object('items_subtotal',expected,'discount_total','0.00','shipping_total','0.00','shipping_tax','0.00','cart_tax','0.00','total_tax','0.00','fees_total','0.00','refunded_total','0.00','total',expected),
  'payment','{"method":"m9_synthetic_no_payment","transaction_id":"","paid_at":null,"is_paid":false}'::jsonb,
  'lines',jsonb_build_array(jsonb_build_object('line_id',ctx->'reference'->'line_id','subtotal',expected,'total',expected,'subtotal_tax','0.00','total_tax','0.00')),
  'counts','{"coupons":0,"shipping":0,"fees":0,"refunds":0}'::jsonb);
 i:=jsonb_build_object('actor_id',actor,'id',tid,'snapshot',s,'observed_at',clock_timestamp());
 foreach k in array array['role','actor','trial','extra','stale','currency','origin','barcode','paid','transaction','method','bad_date','calendar_date','fee','wrong_total','decimal','numeric','missing_money','extra_buyer','wrong_line'] loop
  bad:=i;wanted:='FINANCE_SNAPSHOT_CHANGED';
  case k
   when 'role' then perform set_config('request.jwt.claims','{"role":"authenticated"}',true);wanted:='FINANCE_SERVER_ONLY';
   when 'actor' then bad:=jsonb_set(bad,'{actor_id}',to_jsonb(gen_random_uuid()));wanted:='NOT_AUTHORIZED';
   when 'trial' then bad:=jsonb_set(bad,'{id}',to_jsonb(gen_random_uuid()));wanted:='FINANCE_TRIAL_NOT_FOUND';
   when 'extra' then bad:=bad||'{"cost_cents":0}';wanted:='FINANCE_INPUT_INVALID';
   when 'stale' then bad:=jsonb_set(bad,'{observed_at}',to_jsonb(clock_timestamp()-interval '10 minutes'));wanted:='FINANCE_OBSERVATION_STALE';
   when 'currency' then bad:=jsonb_set(bad,'{snapshot,currency}','"USD"');
   when 'origin' then bad:=jsonb_set(bad,'{snapshot,reference,origin}','"https://vaquerosm.com"');
   when 'barcode' then bad:=jsonb_set(bad,'{snapshot,reference,barcode}','"010582"');
   when 'paid' then bad:=jsonb_set(bad,'{snapshot,payment,is_paid}','true');
   when 'transaction' then bad:=jsonb_set(bad,'{snapshot,payment,transaction_id}','"NOT_A_PAYMENT"');
   when 'method' then bad:=jsonb_set(bad,'{snapshot,payment,method}','"CASH"');
   when 'bad_date' then bad:=jsonb_set(bad,'{snapshot,payment,paid_at}','"not-a-date"');
   when 'calendar_date' then bad:=jsonb_set(bad,'{snapshot,payment,paid_at}','"2026-02-31T00:00:00Z"');
   when 'fee' then bad:=jsonb_set(bad,'{snapshot,money,fees_total}','"0.01"');wanted:='FINANCE_TOTALS_CHANGED';
   when 'wrong_total' then bad:=jsonb_set(bad,'{snapshot,money,total}','"1.00"');wanted:='FINANCE_TOTALS_CHANGED';
   when 'decimal' then bad:=jsonb_set(bad,'{snapshot,money,total}','"1640.000"');wanted:='FINANCE_DECIMAL_INVALID';
   when 'numeric' then bad:=jsonb_set(bad,'{snapshot,money,total}','1640');wanted:='FINANCE_DECIMAL_INVALID';
   when 'missing_money' then bad:=jsonb_set(bad,'{snapshot,money}',(s->'money')-'shipping_total');
   when 'extra_buyer' then bad:=jsonb_set(bad,'{snapshot}',s||'{"email":"not-collected.invalid"}');
   when 'wrong_line' then bad:=jsonb_set(bad,'{snapshot,lines,0,line_id}','999');
  end case;
  caught:=false;begin perform public.m9_record_woo_finance_read(bad);
  exception when others then if sqlerrm<>wanted then raise exception 'EXPECTED %, GOT %',wanted,sqlerrm;end if;caught:=true;end;
  if not caught then raise exception 'FINANCE_REJECTION_MISSING %',k;end if;n:=n+1;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 end loop;
 r:=public.m9_record_woo_finance_read(i);
 if r->'review'->>'classification'<>'CANCELLED_UNPAID' or r->'review'->'can_record_sale'<>'false'::jsonb or r->'review'->'can_issue_sale_ticket'<>'false'::jsonb or r->'review'->'paid_amount_cents'<>'null'::jsonb then raise exception 'FINANCE_WRONG_CLASSIFICATION';end if;
 if (public.m9_record_woo_finance_read(i))->>'id'<>r->>'id' then raise exception 'FINANCE_REPLAY_CHANGED';end if;
 i:=jsonb_set(i,'{snapshot,payment,paid_at}','"2026-10-22T00:12:03+00:00"');
 r:=public.m9_record_woo_finance_read(i);
 if r->'review'->>'classification'<>'CANCELLED_PAYMENT_DATE_REVIEW' or r->'review'->'can_record_sale'<>'false'::jsonb or r->'review'->'paid_amount_cents'<>'null'::jsonb then raise exception 'FINANCE_DATE_BECAME_PAYMENT';end if;
 caught:=false;begin update app.m9_woo_finance_reads set review='{}' where id=(r->>'id')::uuid;
 exception when others then if sqlerrm<>'WOO_PILOT_RECEIPT_IMMUTABLE' then raise;end if;caught:=true;end;
 if not caught then raise exception 'FINANCE_EVIDENCE_MUTABLE';end if;
 if has_function_privilege('authenticated','public.m9_record_woo_finance_read(jsonb)','EXECUTE') or has_function_privilege('anon','public.m9_woo_finance_context(uuid)','EXECUTE') or has_table_privilege('authenticated','app.m9_woo_finance_reads','SELECT') then raise exception 'FINANCE_API_LEAK';end if;
 insert into finance_test_results values(jsonb_build_object('negative_checks',n,'immutable',true,'same_read_replay',true,'paid_date_still_review',true,'financial_posting',false,'real_remote_read',false));
end $$;
select result from finance_test_results;
rollback;
