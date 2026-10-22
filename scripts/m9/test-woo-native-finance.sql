-- SYNTHETIC PAYMENT/STOCK ONLY. No remote Woo. Always ROLLBACK.
begin;
set local standard_conforming_strings=on;
set local statement_timeout='120s';
set local lock_timeout='5s';
lock table app.m9_woo_finance_pilot_control,app.m9_woo_pilot_control,app.m9_woo_pilot_links,app.m9_rehearsal_control,app.m9_rehearsal_allowlist in share row exclusive mode;
create temporary table woo_native_finance_results(result jsonb) on commit drop;
create function pg_temp.woo_native_packet(eid uuid,op text,version bigint,action text default 'POST')returns jsonb language sql as $$
 select jsonb_build_object('store_origin',origin,'order_id',order_id,'expected_version',version,'operation_id',op,'action',action,'evidence_id',id,'evidence_sha256',source_sha256)from app.m9_woo_finance_test_evidence where id=eid;
$$;
create function pg_temp.woo_finance_expect(p jsonb,wanted text)returns void language plpgsql as $$
declare caught boolean:=false;
begin begin perform app.m9_woo_native_finance(p);exception when others then if sqlerrm<>wanted then raise exception 'EXPECTED %, GOT %',wanted,sqlerrm;end if;caught:=true;end;
 if not caught then raise exception 'MISSING_REJECTION %',wanted;end if;
end $$;
create function pg_temp.woo_stock_packet(oid bigint,op text,version bigint,action text,lines jsonb)returns jsonb language sql as $$
 select jsonb_build_object('store_origin','https://salmon-nightingale-251188.hostingersite.com','order_id',oid,'operation_id',op,'expected_version',version,'action',action,'evidence_sha256',repeat('d',64),'reason','SYNTHETIC native finance rollback QA; not a real source order','lines',lines);
$$;
create function pg_temp.woo_finance_evidence(oid bigint,lines jsonb,kind text default 'PAYMENT',original uuid default null)returns uuid language plpgsql as $$
declare result uuid;full_lines jsonb;total bigint;
begin
 select jsonb_agg(x||jsonb_build_object('unit_price_cents',v.price_cents,'line_total_cents',v.price_cents*(x->>'quantity')::bigint) order by (x->>'line_id')::bigint),sum(v.price_cents*(x->>'quantity')::bigint)
 into full_lines,total from jsonb_array_elements(lines)x join app.m9_woo_pilot_links l on l.woo_product_id=(x->>'product_id')::bigint and l.woo_variation_id=(x->>'variation_id')::bigint join public.variants v on v.id=l.variant_id;
 insert into app.m9_woo_finance_test_evidence(origin,order_id,actor_id,kind,gateway_mode,source_sha256,reference,currency,total_cents,observed_at,lines,components,original_evidence_id,refunded_cents,physical_reference,physical_lines)
 values('https://salmon-nightingale-251188.hostingersite.com',oid,app.current_user_id(),kind,'SYNTHETIC_TEST_ONLY',repeat('d',64),'SYNTHETIC-'||gen_random_uuid(),'MXN',total,clock_timestamp(),full_lines,
 jsonb_build_object('items_subtotal',total,'discount_total',0,'shipping_total',0,'shipping_tax',0,'fees_total',0,'total_tax',0,'refunded_total',0,'total',total),original,case when kind='FULL_CANCEL' then total else 0 end,
 case when kind='FULL_CANCEL' then 'SYNTHETIC-physical-'||oid end,case when kind='FULL_CANCEL' then full_lines else '[]' end)returning id into result;return result;
end $$;
create function pg_temp.woo_evidence_copy(eid uuid,patch jsonb)returns uuid language plpgsql as $$
declare original jsonb;r app.m9_woo_finance_test_evidence;
begin select to_jsonb(e) into original from app.m9_woo_finance_test_evidence e where id=eid;
 original:=original||jsonb_build_object('id',gen_random_uuid(),'reference','SYNTHETIC-'||gen_random_uuid())||patch;
 r:=jsonb_populate_record(null::app.m9_woo_finance_test_evidence,original);insert into app.m9_woo_finance_test_evidence select(r).*;return r.id;
end $$;
create function pg_temp.woo_finance_state()returns jsonb language plpgsql as $$
declare names text[]:=array['public.sales','public.sale_items','public.sale_payments','public.folios','public.idempotency_keys','public.inventory_by_location','public.inventory_movements','public.inventory_reservation_movements','public.cash_movements','public.audit_log','app.m9_woo_pilot_orders','app.m9_woo_pilot_lines','app.m9_woo_pilot_receipts','app.m9_woo_pilot_stock_outbox','app.m9_woo_finance_postings','app.m9_woo_finance_receipts','app.m9_woo_finance_ticket_outbox'];n text;h text;result jsonb:='{}';
begin foreach n in array names loop execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,''|'' order by to_jsonb(t)::text),''''))from %s t',n)into h;result:=result||jsonb_build_object(n,h);end loop;return result;end $$;
create function pg_temp.woo_fail_finance_outbox()returns trigger language plpgsql as $$
begin if current_setting('m9.qa_fail_finance_outbox',true)='on' then raise exception 'QA_FINANCE_OUTBOX_FAILURE';end if;return new;end $$;
create trigger m9_qa_finance_outbox_failure before insert on app.m9_woo_finance_ticket_outbox for each row execute function pg_temp.woo_fail_finance_outbox();

do $test$
declare actor uuid:='2b5e4ba1-00f2-48c7-bbe0-273340629711';loc uuid:='467765fe-d18e-43bb-be68-326adbf05ce1';cs uuid;
 v1 uuid;v2 uuid;a jsonb;b jsonb;lines jsonb;e uuid;other_e uuid;refund uuid;p jsonb;result jsonb;again jsonb;before_state jsonb;negative int:=0;checks int:=0;replays int:=0;k text;pay_amount bigint;native_sale uuid;cash_count bigint;ticket jsonb;
begin
 perform app.assert_sicar_staging_enabled();perform set_config('request.jwt.claim.sub',actor::text,true);
 if exists(select 1 from app.m9_woo_finance_pilot_control where enabled) or exists(select 1 from app.m9_woo_finance_postings) or exists(select 1 from app.m9_woo_finance_test_evidence) or exists(select 1 from app.m9_woo_pilot_orders) or exists(select 1 from app.m9_woo_pilot_links) then raise exception 'FINANCE_FIXTURE_NOT_EMPTY_DISABLED';end if;
 select id into strict cs from public.cash_sessions where cashier_user_id=actor and location_id=loc and status='OPEN';
 select variant_id into strict v1 from app.m9_rows where barcode='236';select variant_id into strict v2 from app.m9_rows where barcode='10521';
 if exists(select 1 from public.inventory_by_location where variant_id in(v1,v2)and location_id=loc and(qty<>0 or reserved_qty<>0))or exists(select 1 from public.variants where id in(v1,v2) and(cost_cents is not null or price_cents<=0))then raise exception 'FINANCE_FIXTURE_BASELINE_CHANGED';end if;
 select count(*)into cash_count from public.cash_movements;
 perform pg_temp.woo_finance_expect(jsonb_build_object('action','POST'),'WOO_FINANCE_DISABLED');negative:=negative+1;
 update app.m9_woo_finance_pilot_control set enabled=true,actor_id=actor,location_id=loc,cash_session_id=cs,expires_at=clock_timestamp()+interval '10 minutes' where singleton;
 update app.m9_woo_pilot_control set enabled=true,actor_id=actor,location_id=loc,expires_at=clock_timestamp()+interval '10 minutes'where singleton;
 update app.m9_rehearsal_control set review_sha256=repeat('e',64),expires_at=clock_timestamp()+interval '10 minutes'where singleton;
 update app.m9_rehearsal_allowlist set review_sha256=repeat('e',64),expected_row=app.m9_rehearsal_current_row(variant_id)where variant_id in(v1,v2);
 insert into public.payment_methods(code,name,kind,requires_reference)values('M9_WEB_TEST','SYNTHETIC WEB QA; no gateway','OTHER',true);
 insert into app.m9_woo_pilot_links(origin,woo_product_id,woo_variation_id,variant_id,barcode,evidence_sha256)values
 ('https://salmon-nightingale-251188.hostingersite.com',9000003001,0,v1,'236',repeat('d',64)),('https://salmon-nightingale-251188.hostingersite.com',9000003002,0,v2,'10521',repeat('d',64));
 perform app.apply_movement(v1,loc,'INITIAL_IMPORT',5,'M9_WOO_FINANCE_QA','rollback-only','{"synthetic":true}');
 perform app.apply_movement(v2,loc,'INITIAL_IMPORT',3,'M9_WOO_FINANCE_QA','rollback-only','{"synthetic":true}');
 a:=jsonb_build_array(jsonb_build_object('line_id',1,'product_id',9000003001::bigint,'variation_id',0,'barcode','236','quantity',2));
 b:=jsonb_build_array(jsonb_build_object('line_id',2,'product_id',9000003002::bigint,'variation_id',0,'barcode','10521','quantity',1));lines:=a||b;
 perform app.m9_woo_pilot_command(pg_temp.woo_stock_packet(9000004001,'reserve',0,'RESERVE',lines));
 e:=pg_temp.woo_finance_evidence(9000004001,lines);p:=pg_temp.woo_native_packet(e,'post',1);
 foreach k in array array['extra','production','numeric_code','null_action','version','identity','shipping','stale','missing_payment','line_total','scope','reused_reference']loop
  case k
   when 'extra' then perform pg_temp.woo_finance_expect(p||'{"cost_cents":0}','WOO_FINANCE_PACKET_INVALID');
   when 'production' then perform pg_temp.woo_finance_expect(jsonb_set(p,'{store_origin}','"https://vaquerosm.com"'),'WOO_FINANCE_PACKET_INVALID');
   when 'numeric_code' then other_e:=pg_temp.woo_evidence_copy(e,jsonb_build_object('lines',jsonb_set((select x.lines from app.m9_woo_finance_test_evidence x where id=e),'{0,barcode}','236')));perform pg_temp.woo_finance_expect(pg_temp.woo_native_packet(other_e,'numeric',1),'WOO_FINANCE_LINE_INVALID');
   when 'null_action' then perform pg_temp.woo_finance_expect(jsonb_set(p,'{action}','null'),'WOO_FINANCE_PACKET_INVALID');
   when 'version' then perform pg_temp.woo_finance_expect(jsonb_set(p,'{expected_version}','2'),'WOO_FINANCE_ORDER_VERSION_CONFLICT');
   when 'identity' then other_e:=pg_temp.woo_evidence_copy(e,jsonb_build_object('lines',jsonb_set((select x.lines from app.m9_woo_finance_test_evidence x where id=e),'{0,barcode}','"0236"')));perform pg_temp.woo_finance_expect(pg_temp.woo_native_packet(other_e,'identity',1),'WOO_FINANCE_IDENTITY_CHANGED');
   when 'shipping' then other_e:=pg_temp.woo_evidence_copy(e,jsonb_build_object('components',jsonb_set((select x.components from app.m9_woo_finance_test_evidence x where id=e),'{shipping_total}','100')));perform pg_temp.woo_finance_expect(pg_temp.woo_native_packet(other_e,'shipping',1),'WOO_FINANCE_COMPONENT_REVIEW_REQUIRED');
   when 'stale' then other_e:=pg_temp.woo_evidence_copy(e,jsonb_build_object('observed_at',clock_timestamp()-interval '1 hour'));perform pg_temp.woo_finance_expect(pg_temp.woo_native_packet(other_e,'stale',1),'WOO_FINANCE_EVIDENCE_REQUIRED');
   when 'missing_payment' then perform pg_temp.woo_finance_expect(jsonb_set(p,'{evidence_id}',to_jsonb(gen_random_uuid())),'WOO_FINANCE_EVIDENCE_REQUIRED');
   when 'line_total' then other_e:=pg_temp.woo_evidence_copy(e,jsonb_build_object('lines',jsonb_set((select x.lines from app.m9_woo_finance_test_evidence x where id=e),'{0,line_total_cents}','1')));perform pg_temp.woo_finance_expect(pg_temp.woo_native_packet(other_e,'line-total',1),'WOO_FINANCE_LINE_TOTAL_INVALID');
   when 'scope' then other_e:=pg_temp.woo_evidence_copy(e,jsonb_build_object('lines',(select x.lines->0 from app.m9_woo_finance_test_evidence x where id=e)));perform pg_temp.woo_finance_expect(pg_temp.woo_native_packet(other_e,'scope',1),'WOO_FINANCE_COMPONENTS_REQUIRED');
   when 'reused_reference' then
    begin perform pg_temp.woo_evidence_copy(e,jsonb_build_object('reference',(select reference from app.m9_woo_finance_test_evidence where id=e)));raise exception 'DUPLICATE_PAYMENT_REFERENCE_ACCEPTED';exception when unique_violation then null;end;
  end case;negative:=negative+1;
 end loop;
 -- The last-piece guard used by POS cannot sell the reserved units.
 begin perform public.create_sale(gen_random_uuid(),cs,jsonb_build_array(jsonb_build_object('variant_id',v1,'quantity',4)),jsonb_build_array(jsonb_build_object('method_code','M9_WEB_TEST','amount_cents',(select price_cents*4 from public.variants where id=v1),'reference','SYNTHETIC-POS-oversell')));raise exception 'POS_OVERSELL_ACCEPTED';exception when others then if sqlerrm<>'INSUFFICIENT_STOCK' then raise;end if;end;negative:=negative+1;
 before_state:=pg_temp.woo_finance_state();perform set_config('m9.qa_fail_finance_outbox','on',true);perform pg_temp.woo_finance_expect(p,'QA_FINANCE_OUTBOX_FAILURE');perform set_config('m9.qa_fail_finance_outbox','off',true);
 if before_state<>pg_temp.woo_finance_state() then raise exception 'FINANCE_POST_FAILURE_NOT_ATOMIC';end if;checks:=checks+1;negative:=negative+1;
 result:=app.m9_woo_native_finance(p);again:=app.m9_woo_native_finance(p);native_sale:=(result->>'sale_id')::uuid;
 if result->>'receipt_id'<>again->>'receipt_id' or again->'replayed'<>'true'::jsonb then raise exception 'FINANCE_POST_REPLAY_FAILED';end if;replays:=replays+1;
 if not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=3 and reserved_qty=0)or not exists(select 1 from public.inventory_by_location where variant_id=v2 and location_id=loc and qty=2 and reserved_qty=0)then raise exception 'FINANCE_STOCK_DEDUCTED_MORE_THAN_ONCE';end if;checks:=checks+1;
 if(select count(*)from public.inventory_movements where reference_type='SALE' and reference_id=native_sale::text)<>2 or exists(select 1 from public.sale_items where sale_id=native_sale and unit_cost_cents is not null)then raise exception 'FINANCE_NATIVE_COST_OR_MOVEMENTS_INVALID';end if;checks:=checks+1;
 if(select count(*)from public.sale_payments where sale_id=native_sale and method_code='M9_WEB_TEST')<>1 or(select count(*)from public.cash_movements)<>cash_count then raise exception 'FINANCE_CREATED_CASH';end if;checks:=checks+1;
 if not exists(select 1 from app.m9_woo_pilot_stock_outbox where finance_receipt_id=(result->>'receipt_id')::uuid)or(select count(*)from app.m9_woo_finance_ticket_outbox)<>1 then raise exception 'FINANCE_OUTBOX_NOT_ATOMIC';end if;checks:=checks+1;
 ticket:=public.get_sale_ticket_by_folio(loc,result->>'sale_folio');
 if ticket is null then raise exception 'FINANCE_NATIVE_TICKET_NOT_AVAILABLE';end if;checks:=checks+1;
 perform pg_temp.woo_finance_expect(jsonb_set(p,'{operation_id}','"reuse-payment"'),'WOO_FINANCE_PAYMENT_REUSED');negative:=negative+1;
 perform pg_temp.woo_finance_expect(jsonb_set(p,'{evidence_sha256}',to_jsonb(repeat('a',64))),'WOO_FINANCE_OPERATION_REUSED');negative:=negative+1;
 begin perform app.m9_woo_pilot_command(pg_temp.woo_stock_packet(9000004001,'wrong-technical-consume',2,'CONSUME',a));raise exception 'TECHNICAL_CONSUME_ACCEPTED';exception when others then if sqlerrm<>'WOO_ORDER_FINANCIALLY_BOUND' then raise;end if;end;negative:=negative+1;
 begin perform public.cancel_sale(native_sale,'SYNTHETIC manual cancellation blocked');raise exception 'MANUAL_CANCEL_ACCEPTED';exception when others then if sqlerrm<>'WOO_FINANCE_SERVICE_REQUIRED' then raise;end if;end;negative:=negative+1;
 refund:=pg_temp.woo_finance_evidence(9000004001,lines,'FULL_CANCEL',e);p:=pg_temp.woo_native_packet(refund,'full-cancel',2,'FULL_CANCEL');
 other_e:=pg_temp.woo_evidence_copy(refund,'{"physical_lines":[]}'::jsonb);perform pg_temp.woo_finance_expect(pg_temp.woo_native_packet(other_e,'money-without-stock',2,'FULL_CANCEL'),'WOO_FINANCE_FULL_RETURN_PROOF_REQUIRED');negative:=negative+1;
 before_state:=pg_temp.woo_finance_state();perform set_config('m9.qa_fail_finance_outbox','on',true);perform pg_temp.woo_finance_expect(p,'QA_FINANCE_OUTBOX_FAILURE');perform set_config('m9.qa_fail_finance_outbox','off',true);
 if before_state<>pg_temp.woo_finance_state()then raise exception 'FINANCE_CANCEL_FAILURE_NOT_ATOMIC';end if;checks:=checks+1;negative:=negative+1;
 result:=app.m9_woo_native_finance(p);again:=app.m9_woo_native_finance(p);
 if result->>'receipt_id'<>again->>'receipt_id'or again->'replayed'<>'true'::jsonb then raise exception 'FINANCE_CANCEL_REPLAY_FAILED';end if;replays:=replays+1;
 if not exists(select 1 from public.sales where id=native_sale and status='CANCELLED')or not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=5 and reserved_qty=0)or not exists(select 1 from public.inventory_by_location where variant_id=v2 and location_id=loc and qty=3 and reserved_qty=0)then raise exception 'FINANCE_CANCEL_NOT_RESTORED';end if;checks:=checks+1;
 if(select count(*)from public.inventory_movements where reference_type='SALE_CANCELLATION'and reference_id=native_sale::text)<>2 or(select count(*)from public.cash_movements)<>cash_count then raise exception 'FINANCE_CANCEL_DUPLICATE_OR_CASH';end if;checks:=checks+1;
 if exists(select 1 from app.m9_woo_pilot_lines where order_id=9000004001 and(reserved_qty<>0 or consumed_qty<>ordered_qty or restocked_qty<>ordered_qty))then raise exception 'FINANCE_CANCEL_RESERVATION_DIVERGED';end if;checks:=checks+1;
 again:=app.m9_woo_native_finance(pg_temp.woo_native_packet(e,'post',1));if again->'replayed'<>'true'::jsonb then raise exception 'FINANCE_POST_REPLAY_AFTER_CANCEL_FAILED';end if;replays:=replays+1;
 insert into woo_native_finance_results values(jsonb_build_object('mode','SYNTHETIC_NATIVE_FINANCE_ROLLBACK','negative_checks',negative,'invariants',checks,'replays',replays,'native_sales',1,'native_payments',1,'native_items',2,'deduction_movements',2,'restoration_movements',2,'physical_cash_movements',0,'unknown_cost_preserved',true,'ticket_read',ticket is not null,'remote_woo_orders_created',0,'real_gateway_payments',0));
end $test$;
select * from woo_native_finance_results;
rollback;
