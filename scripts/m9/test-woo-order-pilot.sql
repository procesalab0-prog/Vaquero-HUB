-- SYNTHETIC TECHNICAL QA ONLY. Never approved SICAR stock. Always ROLLBACK.
begin;
set local standard_conforming_strings=on;
set local statement_timeout='90s';
set local lock_timeout='5s';
lock table app.m9_woo_pilot_control,app.m9_woo_pilot_links,app.m9_rehearsal_control,
 app.m9_rehearsal_allowlist in share row exclusive mode;
create temporary table woo_pilot_results(result jsonb) on commit drop;
create function pg_temp.woo_expect_error(packet jsonb, message text) returns void
language plpgsql as $$
declare caught boolean:=false;
begin
 begin perform app.m9_woo_pilot_command(packet);
 exception when others then
  if sqlerrm<>message then raise exception 'EXPECTED %, GOT %',message,sqlerrm; end if;
  caught:=true;
 end;
 if not caught then raise exception 'MISSING_REJECTION %',message; end if;
end $$;
create function pg_temp.woo_packet(oid bigint,operation text,version bigint,action text,lines jsonb) returns jsonb
language sql as $$ select jsonb_build_object('store_origin','https://salmon-nightingale-251188.hostingersite.com',
 'order_id',oid,'operation_id',operation,'expected_version',version,'action',action,
 'evidence_sha256',repeat('b',64),'reason','SYNTHETIC ROLLBACK QA; not a source order or physical count','lines',lines) $$;
-- Inject failure AFTER the native movement and receipt, before the dirty stock row.
create function pg_temp.fail_woo_outbox() returns trigger language plpgsql as $$
begin
 if current_setting('m9.qa_fail_outbox',true)='on' then raise exception 'QA_OUTBOX_FAILURE'; end if;
 return new;
end $$;
create trigger m9_woo_qa_outbox_fail before insert or update on app.m9_woo_pilot_stock_outbox
for each row execute function pg_temp.fail_woo_outbox();

do $test$
declare
 actor uuid:='2b5e4ba1-00f2-48c7-bbe0-273340629711';
 loc uuid:='467765fe-d18e-43bb-be68-326adbf05ce1';
 v1 uuid; v2 uuid; x jsonb; a jsonb; b jsonb; packet jsonb; got jsonb; receipt jsonb;
 checks integer:=0; negatives integer:=0; replays integer:=0; operation integer:=0; acl integer:=0;
 before_reservations bigint; before_movements bigint; prior_receipts bigint;
begin
 perform app.assert_sicar_staging_enabled();
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if exists(select 1 from app.m9_woo_pilot_control where enabled) or exists(select 1 from app.m9_woo_pilot_orders)
  or exists(select 1 from app.m9_woo_pilot_links) or exists(select 1 from app.m9_woo_pilot_receipts)
  or exists(select 1 from app.m9_woo_pilot_stock_outbox) then raise exception 'PILOT_NOT_EMPTY_DISABLED'; end if;
 select variant_id into strict v1 from app.m9_rows where barcode='236';
 select variant_id into strict v2 from app.m9_rows where barcode='10521';
 if not exists(select 1 from app.m9_rehearsal_control where singleton and enabled and expires_at<clock_timestamp())
  then raise exception 'EXISTING_SALE_GUARD_REQUIRED'; end if;
 if exists(select 1 from public.inventory_by_location where variant_id in (v1,v2) and location_id=loc and (qty<>0 or reserved_qty<>0))
  then raise exception 'FIXTURE_BASELINE_NOT_ZERO'; end if;
 if exists(select 1 from public.variants where id in(v1,v2) and cost_cents is not null) then raise exception 'EXPECTED_UNKNOWN_COSTS'; end if;
 select count(*) into before_reservations from public.inventory_reservation_movements;
 select count(*) into before_movements from public.inventory_movements;
 a:=jsonb_build_array(jsonb_build_object('line_id',1,'product_id',9000001001::bigint,'variation_id',0,'barcode','236','quantity',4));
 b:=jsonb_build_array(jsonb_build_object('line_id',2,'product_id',9000001002::bigint,'variation_id',0,'barcode','10521','quantity',2));
 packet:=pg_temp.woo_packet(9000002001,'reserve:1',0,'RESERVE',a);
 perform pg_temp.woo_expect_error(packet,'WOO_PILOT_DISABLED'); negatives:=negatives+1;
 update app.m9_woo_pilot_control set enabled=true,actor_id=actor,location_id=loc,expires_at=clock_timestamp()+interval '10 minutes' where singleton;
 insert into app.m9_woo_pilot_links(origin,woo_product_id,woo_variation_id,variant_id,barcode,evidence_sha256)
 values('https://salmon-nightingale-251188.hostingersite.com',9000001001,0,v1,'236',repeat('b',64)),
 ('https://salmon-nightingale-251188.hostingersite.com',9000001002,0,v2,'10521',repeat('b',64));
 -- A transient two-code review, preserving the real guard and every other block.
 update app.m9_rehearsal_control set review_sha256=repeat('c',64),expires_at=clock_timestamp()+interval '10 minutes' where singleton;
 update app.m9_rehearsal_allowlist set review_sha256=repeat('c',64),expected_row=app.m9_rehearsal_current_row(variant_id)
 where variant_id in(v1,v2);
 if app.m9_rehearsal_status(v1) is not null or app.m9_rehearsal_status(v2) is not null then raise exception 'FIXTURE_REVIEW_FAILED'; end if;
 perform app.apply_movement(v1,loc,'INITIAL_IMPORT',5,'M9_WOO_QA_FIXTURE','rollback-only',jsonb_build_object('synthetic',true));
 perform app.apply_movement(v2,loc,'INITIAL_IMPORT',3,'M9_WOO_QA_FIXTURE','rollback-only',jsonb_build_object('synthetic',true));
 receipt:=app.m9_woo_pilot_command(packet); operation:=operation+1;
 if receipt->>'version'<>'1' or receipt->>'financial_payment_recorded'<>'false'
  or not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=5 and reserved_qty=4)
  then raise exception 'RESERVE_FAILED'; end if; checks:=checks+1;
 got:=app.m9_woo_pilot_command(packet);
 if got->>'replayed'<>'true' or got->>'receipt_id'<>receipt->>'receipt_id' then raise exception 'REPLAY_FAILED'; end if; replays:=replays+1;
 perform pg_temp.woo_expect_error(jsonb_set(packet,'{reason}','"different"'),'WOO_OPERATION_REUSED'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002001,'new-reserve',1,'RESERVE',a),'WOO_ORDER_ALREADY_RESERVED'); negatives:=negatives+1;
 -- Another order cannot consume the four pieces reserved by the first.
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002002,'reserve:2',0,'RESERVE',jsonb_set(a,'{0,quantity}','2')),'INSUFFICIENT_STOCK'); negatives:=negatives+1;
 if exists(select 1 from app.m9_woo_pilot_orders where order_id=9000002002) then raise exception 'FAILED_ORDER_REMAINS'; end if; checks:=checks+1;
 -- The same native ledger used by POS must also respect Woo's reservation.
 begin
  perform app.apply_movement(v1,loc,'SALE',2*-1,'M9_WOO_POS_QA','oversell',jsonb_build_object('synthetic',true));
  raise exception 'POS_OVERSELL_ACCEPTED';
 exception when others then if sqlerrm<>'INSUFFICIENT_STOCK' then raise; end if; negatives:=negatives+1; end;
 packet:=pg_temp.woo_packet(9000002001,'consume:1',1,'CONSUME',jsonb_set(a,'{0,quantity}','2'));
 receipt:=app.m9_woo_pilot_command(packet); operation:=operation+1;
 got:=app.m9_woo_pilot_command(packet); if got->>'receipt_id'<>receipt->>'receipt_id' or got->>'replayed'<>'true' then raise exception 'CONSUME_REPLAY'; end if; replays:=replays+1;
 if not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=3 and reserved_qty=2)
  then raise exception 'CONSUME_FAILED'; end if; checks:=checks+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002001,'late:1',1,'CONSUME',jsonb_set(a,'{0,quantity}','1')),'WOO_ORDER_VERSION_CONFLICT'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002001,'over-consume',2,'CONSUME',a),'WOO_LINE_QUANTITY_EXCEEDED'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002001,'over-return',2,'RESTOCK',a),'WOO_LINE_QUANTITY_EXCEEDED'); negatives:=negatives+1;
 packet:=pg_temp.woo_packet(9000002001,'release:1',2,'RELEASE',jsonb_set(a,'{0,quantity}','1'));
 receipt:=app.m9_woo_pilot_command(packet); operation:=operation+1;
 got:=app.m9_woo_pilot_command(packet); if got->>'replayed'<>'true' then raise exception 'RELEASE_REPLAY'; end if; replays:=replays+1;
 packet:=pg_temp.woo_packet(9000002001,'consume:2',3,'CONSUME',jsonb_set(a,'{0,quantity}','1'));
 perform app.m9_woo_pilot_command(packet); operation:=operation+1;
 packet:=pg_temp.woo_packet(9000002001,'return:1',4,'RESTOCK',jsonb_set(a,'{0,quantity}','1'));
 receipt:=app.m9_woo_pilot_command(packet); operation:=operation+1;
 got:=app.m9_woo_pilot_command(packet); if got->>'replayed'<>'true' then raise exception 'RESTOCK_REPLAY'; end if; replays:=replays+1;
 packet:=pg_temp.woo_packet(9000002001,'return:2',5,'RESTOCK',jsonb_set(a,'{0,quantity}','2'));
 perform app.m9_woo_pilot_command(packet); operation:=operation+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002001,'over-return2',6,'RESTOCK',jsonb_set(a,'{0,quantity}','1')),'WOO_LINE_QUANTITY_EXCEEDED'); negatives:=negatives+1;
 if not exists(select 1 from app.m9_woo_pilot_lines where order_id=9000002001 and consumed_qty=3 and released_qty=1 and restocked_qty=3 and reserved_qty=0)
  or not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=5 and reserved_qty=0)
  then raise exception 'PARTIAL_NET_NOT_ZERO'; end if; checks:=checks+1;
 -- Full cancellation of an unpaid reservation changes availability, not physical.
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002002,'reserve:2',0,'RESERVE',b)); operation:=operation+1;
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002002,'cancel:2',1,'RELEASE',b)); operation:=operation+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002002,'late-payment',2,'CONSUME',b),'WOO_LINE_QUANTITY_EXCEEDED'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002002,'money-only-return',2,'RESTOCK',b),'WOO_LINE_QUANTITY_EXCEEDED'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002099,'early',0,'CONSUME',b),'WOO_ORDER_NOT_RESERVED'); negatives:=negatives+1;
 -- All effects from earlier lines must roll back if any later line fails.
 x:=jsonb_set(a,'{0,quantity}','6')||b;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002003,'multi-fail',0,'RESERVE',x),'INSUFFICIENT_STOCK'); negatives:=negatives+1;
 if exists(select 1 from app.m9_woo_pilot_orders where order_id=9000002003)
  or exists(select 1 from public.inventory_by_location where variant_id in(v1,v2) and location_id=loc and reserved_qty<>0)
  then raise exception 'MULTI_LINE_NOT_ATOMIC'; end if; checks:=checks+1;
 -- Two variants in one order, then a complete restoration, same native ledger.
 x:=jsonb_set(a,'{0,quantity}','1')||jsonb_set(b,'{0,quantity}','1');
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002004,'multi-reserve',0,'RESERVE',x)); operation:=operation+1;
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002004,'multi-consume',1,'CONSUME',x)); operation:=operation+1;
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002004,'multi-return',2,'RESTOCK',x)); operation:=operation+1;
 -- Bad source identity and malformed quantities never become best guesses.
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002005,'bad-code',0,'RESERVE',jsonb_set(a,'{0,barcode}','"0236"')),'WOO_IDENTITY_UNCONFIRMED'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002005,'bad-id',0,'RESERVE',jsonb_set(a,'{0,variation_id}','7')),'WOO_IDENTITY_UNCONFIRMED'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002005,'bad-qty',0,'RESERVE',jsonb_set(a,'{0,quantity}','1.5')),'WOO_LINE_INVALID'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002005,'numeric-code',0,'RESERVE',jsonb_set(a,'{0,barcode}','236')),'WOO_LINE_INVALID'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002005,'dupe',0,'RESERVE',a||a),'WOO_DUPLICATE_LINE'); negatives:=negatives+1;
 packet:=pg_temp.woo_packet(9000002005,'production',0,'RESERVE',a);
 perform pg_temp.woo_expect_error(jsonb_set(packet,'{store_origin}','"https://vaquerosm.com"'),'WOO_COMMAND_INVALID'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(packet||'{"cost_cents":0}'::jsonb,'WOO_COMMAND_INVALID'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(jsonb_set(packet,'{lines}','[]'),'WOO_LINES_INVALID'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(jsonb_set(packet,'{action}','"refunded"'),'WOO_COMMAND_INVALID'); negatives:=negatives+1;
 -- A change in the second line after the first consumed is still atomic.
 x:=jsonb_set(a,'{0,quantity}','1')||jsonb_set(b,'{0,quantity}','1');
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002009,'reserve:9',0,'RESERVE',x)); operation:=operation+1;
 select count(*) into prior_receipts from app.m9_woo_pilot_receipts;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002009,'consume-fail:9',1,'CONSUME',jsonb_set(x,'{0,quantity}','2')),'WOO_LINE_QUANTITY_EXCEEDED'); negatives:=negatives+1;
 if (select count(*) from app.m9_woo_pilot_receipts)<>prior_receipts
  or not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=5 and reserved_qty=1)
  or not exists(select 1 from public.inventory_by_location where variant_id=v2 and location_id=loc and qty=3 and reserved_qty=1)
  then raise exception 'MULTI_CONSUME_NOT_ATOMIC'; end if; checks:=checks+1;
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002009,'release:9',1,'RELEASE',x)); operation:=operation+1;
 -- Context changes may not turn an authenticated actor into another operator.
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 perform pg_temp.woo_expect_error(packet,'WOO_PILOT_DISABLED'); negatives:=negatives+1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 update app.m9_woo_pilot_control set expires_at=clock_timestamp()-interval '1 second' where singleton;
 perform pg_temp.woo_expect_error(packet,'WOO_PILOT_DISABLED'); negatives:=negatives+1;
 update app.m9_woo_pilot_control set expires_at=clock_timestamp()+interval '1 day' where singleton;
 perform pg_temp.woo_expect_error(packet,'WOO_PILOT_DISABLED'); negatives:=negatives+1;
 update app.m9_woo_pilot_control set expires_at=clock_timestamp()+interval '10 minutes' where singleton;
 -- A crash at the final outbox write may not leave a movement or receipt behind.
 x:=jsonb_set(a,'{0,quantity}','1');
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002010,'reserve:10',0,'RESERVE',x)); operation:=operation+1;
 packet:=pg_temp.woo_packet(9000002010,'consume:10',1,'CONSUME',x);
 select count(*) into prior_receipts from app.m9_woo_pilot_receipts;
 perform set_config('m9.qa_fail_outbox','on',true);
 perform pg_temp.woo_expect_error(packet,'QA_OUTBOX_FAILURE'); negatives:=negatives+1;
 perform set_config('m9.qa_fail_outbox','off',true);
 if (select count(*) from app.m9_woo_pilot_receipts)<>prior_receipts
  or not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=5 and reserved_qty=1)
  or not exists(select 1 from app.m9_woo_pilot_orders where order_id=9000002010 and version=1)
  then raise exception 'FAILURE_LEFT_PARTIAL_EFFECT'; end if; checks:=checks+1;
 receipt:=app.m9_woo_pilot_command(packet); operation:=operation+1;
 got:=app.m9_woo_pilot_command(packet);
 if got->>'replayed'<>'true' or got->>'receipt_id'<>receipt->>'receipt_id' then raise exception 'FAILURE_RETRY_DUPLICATED'; end if; replays:=replays+1;
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002010,'return:10',2,'RESTOCK',x)); operation:=operation+1;
 -- Revoking review blocks new consumption, but releasing/restoring remains possible.
 a:=jsonb_set(a,'{0,quantity}','1');
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002006,'reserve:6',0,'RESERVE',a)); operation:=operation+1;
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002007,'reserve:7',0,'RESERVE',b)); operation:=operation+1;
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002007,'consume:7',1,'CONSUME',b)); operation:=operation+1;
 update app.m9_rehearsal_control set review_sha256=repeat('d',64) where singleton;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002006,'consume-blocked',1,'CONSUME',a),'WOO_VARIANT_BLOCKED'); negatives:=negatives+1;
 perform pg_temp.woo_expect_error(pg_temp.woo_packet(9000002008,'reserve-blocked',0,'RESERVE',a),'WOO_VARIANT_BLOCKED'); negatives:=negatives+1;
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002006,'release:6',1,'RELEASE',a)); operation:=operation+1;
 perform app.m9_woo_pilot_command(pg_temp.woo_packet(9000002007,'return:7',2,'RESTOCK',b)); operation:=operation+1;
 -- Receipt history cannot be rewritten or deleted, even through maintenance.
 begin update app.m9_woo_pilot_receipts set result='{}'; raise exception 'RECEIPT_MUTABLE';
 exception when others then if sqlerrm<>'WOO_PILOT_RECEIPT_IMMUTABLE' then raise; end if; negatives:=negatives+1; end;
 begin delete from app.m9_woo_pilot_receipts; raise exception 'RECEIPT_DELETABLE';
 exception when others then if sqlerrm<>'WOO_PILOT_RECEIPT_IMMUTABLE' then raise; end if; negatives:=negatives+1; end;
 for x in select to_jsonb(r) from (select rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r loop
  if has_function_privilege(x->>'rolname','app.m9_woo_pilot_command(jsonb)','EXECUTE') then raise exception 'FUNCTION_PRIVILEGE_LEAK'; end if;
  acl:=acl+1;
  if exists(select 1 from pg_tables t where t.schemaname='app' and t.tablename like 'm9_woo_pilot_%'
   and has_table_privilege(x->>'rolname',format('%I.%I',t.schemaname,t.tablename),'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'TABLE_PRIVILEGE_LEAK'; end if;
  acl:=acl+1;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='app' and c.relname like 'm9_woo_pilot_%' and c.relkind='r' and not c.relrowsecurity) then raise exception 'RLS_MISSING'; end if; checks:=checks+1;
 if (select count(*) from app.m9_woo_pilot_receipts)<>operation then raise exception 'RECEIPTS_DUPLICATED'; end if; checks:=checks+1;
 if not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=5 and reserved_qty=0)
  or not exists(select 1 from public.inventory_by_location where variant_id=v2 and location_id=loc and qty=3 and reserved_qty=0)
  then raise exception 'FINAL_QA_BALANCES_DIFFER'; end if; checks:=checks+1;
 if (select sum(quantity) from public.inventory_movements where reference_type='M9_WOO_PILOT')<>0
  or (select sum(quantity) from public.inventory_reservation_movements where reference_type='M9_WOO_PILOT')<>0 then raise exception 'NET_MOVEMENT_NOT_ZERO'; end if; checks:=checks+1;
 if exists(select 1 from app.m9_woo_pilot_stock_outbox o join public.inventory_by_location i on i.variant_id=o.variant_id and i.location_id=o.location_id
  where o.available_qty<>i.qty-i.reserved_qty) then raise exception 'OUTBOX_NOT_CURRENT'; end if; checks:=checks+1;
 insert into woo_pilot_results values(jsonb_build_object('mode','SYNTHETIC_WOO_STOCK_ROLLBACK','commands',operation,'idempotent_replays',replays,
  'negative_checks',negatives,'acl_checks',acl,'invariants',checks,'native_stock_movements',(select count(*)-before_movements from public.inventory_movements),
  'native_reservation_movements',(select count(*)-before_reservations from public.inventory_reservation_movements),
  'woo_order_created',false,'financial_payment_recorded',false,'real_stock_imported',false,'source_counts_approved',false,
  'physical_restocks_are_synthetic',true,'real_concurrent_checkout_accepted',false));
end $test$;
select result from woo_pilot_results;
rollback;
