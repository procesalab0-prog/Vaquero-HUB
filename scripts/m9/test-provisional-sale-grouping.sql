-- Maintenance-only staging rehearsal. Synthetic attributes and stock exist only
-- inside this transaction. Sales and refunds are synthetic too. This is not a commercial model approval.
begin;
select app.assert_sicar_staging_enabled();
create temporary table grouping_results(result jsonb);
do $qa$
declare ids uuid[];members jsonb;states jsonb;current_states jsonb;plan jsonb;receipt jsonb;again jsonb;
 sid uuid;price bigint;sale public.sales;replay public.sales;review text;refund jsonb;refund_again jsonb;token uuid;return_key uuid:=gen_random_uuid();sale_key uuid:=gen_random_uuid();
 actor uuid;location uuid;request uuid:=gen_random_uuid();vid uuid;other uuid;checks integer:=0;ledger jsonb;after_ledger jsonb;
begin
 select array_agg(variant_id order by variant_id) into ids from (
  select pv.variant_id from app.m9_provisional_variants pv join public.variants v on v.id=pv.variant_id
   join public.m9_variant_details d on d.variant_id=v.id
   where pv.grouping_status='PROVISIONAL' and (d.department,d.section)=(
    select d2.department,d2.section from app.m9_provisional_variants pv2 join public.m9_variant_details d2 on d2.variant_id=pv2.variant_id
    where pv2.grouping_status='PROVISIONAL' group by d2.department,d2.section having count(*)>=2 order by count(*) desc limit 1)
   order by pv.variant_id limit 2) s;
 if cardinality(ids)<>2 then raise exception 'TWO_COMPATIBLE_PROVISIONALS_REQUIRED';end if;
 vid:=ids[1];other:=ids[2];
 select id,cashier_user_id,location_id into strict sid,actor,location from public.cash_sessions where status='OPEN' order by opened_at desc limit 1;
 if (select count(*) from public.sales)<>0 or (select count(*) from public.inventory_by_location)<>0 then raise exception 'EMPTY_OPERATIONAL_STAGING_REQUIRED';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 -- Labeled, rolled-back synthetic stock. Source costs stay NULL throughout.
 perform public.apply_inventory_adjustment(vid,location,0,2,'CONTEO_FISICO','QA SINTETICO AGRUPACION: dos piezas temporales; ROLLBACK obligatorio');
 -- Temporarily authorize this QA transaction only; restored by ROLLBACK.
 update app.m9_rehearsal_control set expires_at=clock_timestamp()+interval '1 hour' where singleton returning review_sha256 into review;
 insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row)
 select vid,app.m9_rehearsal_current_row(vid)->>'barcode',review,app.m9_rehearsal_current_row(vid)
 on conflict(variant_id) do update set review_sha256=excluded.review_sha256,expected_row=excluded.expected_row;
 select price_cents into strict price from public.variants where id=vid and cost_cents is null;
 sale:=public.create_sale(sale_key,sid,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',1)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',price,'tendered_cents',price)));
 replay:=public.create_sale(sale_key,sid,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',1)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',price,'tendered_cents',price)));
 if sale.id<>replay.id or (select qty from public.inventory_by_location where variant_id=vid and location_id=location)<>1
 or (select count(*) from public.sale_items where sale_id=sale.id and variant_id=vid and unit_cost_cents is null)<>1 then raise exception 'PROVISIONAL_SALE_FAILED';end if;checks:=checks+1;
 ledger:=jsonb_build_object('balances',(select jsonb_agg(to_jsonb(x) order by x.variant_id,x.location_id) from public.inventory_by_location x),
  'movements',(select jsonb_agg(to_jsonb(x) order by x.id) from public.inventory_movements x),
  'sales',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sales x),
  'sale_items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sale_items x),
  'payments',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sale_payments x),
  'cash',(select jsonb_agg(to_jsonb(x) order by x.id) from public.cash_movements x),
  'returns',(select jsonb_agg(to_jsonb(x) order by x.id) from public.returns x),
  'return_items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.return_items x));
 states:=jsonb_build_array(app.m9_provisional_state(vid),app.m9_provisional_state(other));
 members:=jsonb_build_array(jsonb_build_object('variant_id',vid,'attributes',jsonb_build_object('TALLA','QA_SINTETICA_A')),jsonb_build_object('variant_id',other,'attributes',jsonb_build_object('TALLA','QA_SINTETICA_B')));
 if exists(select 1 from (values('anon'),('authenticated'),('service_role')) roles(name)
  where has_table_privilege(name,'app.m9_provisional_variants','INSERT') or has_table_privilege(name,'app.m9_grouping_events','UPDATE')
   or has_function_privilege(name,'app.m9_group_provisionals(uuid,text,jsonb,text,text,text,text)','EXECUTE')) then raise exception 'CLIENT_GROUPING_PRIVILEGE';end if;checks:=checks+1;
 begin
  update public.variants set woocommerce_product_id=999999999 where id=vid;
  raise exception 'WEB_LINK_ALLOWED';
 exception when others then if sqlerrm<>'M9_PROVISIONAL_WEB_BLOCKED' then raise;end if;end;checks:=checks+1;
 begin
  insert into app.web_remote_jobs(product_id,actor_id,request_id,request_hash,packet) values((states#>>'{0,product_id}')::uuid,actor,gen_random_uuid(),'qa','{}');
  raise exception 'REMOTE_QUEUE_ALLOWED';
 exception when others then if sqlerrm<>'M9_PROVISIONAL_WEB_BLOCKED' then raise;end if;end;checks:=checks+1;
 begin
  insert into app.web_lab_jobs(product_id,actor_id,request_id,request_hash,revision,packet) values((states#>>'{0,product_id}')::uuid,actor,gen_random_uuid(),'qa',1,'{}');
  raise exception 'LOCAL_QUEUE_ALLOWED';
 exception when others then if sqlerrm<>'M9_PROVISIONAL_WEB_BLOCKED' then raise;end if;end;checks:=checks+1;
 begin
  perform app.m9_provisional_group_plan('QA NO COMERCIAL · duplicada',jsonb_build_array(jsonb_build_object('variant_id',vid,'attributes','{}'::jsonb),jsonb_build_object('variant_id',other,'attributes','{}'::jsonb)));
  raise exception 'DUPLICATE_ATTRIBUTES_ALLOWED';
 exception when others then if sqlerrm<>'M9_GROUP_DUPLICATE_ATTRIBUTES' then raise;end if;end;checks:=checks+1;
 plan:=app.m9_provisional_group_plan('QA NO COMERCIAL · agrupación temporal',members);
 begin
  perform app.m9_group_provisionals(request,'QA NO COMERCIAL · agrupación temporal',members,repeat('0',64),'Codex QA','Ensayo técnico, sin aprobación comercial',repeat('a',64));
  raise exception 'STALE_PLAN_ALLOWED';
 exception when others then if sqlerrm<>'M9_GROUP_STALE_PLAN' then raise;end if;end;checks:=checks+1;
 receipt:=app.m9_group_provisionals(request,'QA NO COMERCIAL · agrupación temporal',members,plan->>'token','Codex QA','Ensayo técnico, sin aprobación comercial',repeat('a',64));
 if not exists(select 1 from public.variants where id=vid and product_id=(receipt->>'product_id')::uuid)
  or not exists(select 1 from public.variants where id=other and product_id=(receipt->>'product_id')::uuid) then raise exception 'VARIANT_ID_LOST';end if;checks:=checks+1;
 if exists(select 1 from jsonb_array_elements(states) s join public.barcodes b on b.variant_id=(s->>'variant_id')::uuid where b.source='SICAR' and b.code<>s#>>'{current,barcode}') then raise exception 'BARCODE_CHANGED';end if;checks:=checks+1;
 after_ledger:=jsonb_build_object('balances',(select jsonb_agg(to_jsonb(x) order by x.variant_id,x.location_id) from public.inventory_by_location x),
  'movements',(select jsonb_agg(to_jsonb(x) order by x.id) from public.inventory_movements x),
  'sales',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sales x),
  'sale_items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sale_items x),
  'payments',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sale_payments x),
  'cash',(select jsonb_agg(to_jsonb(x) order by x.id) from public.cash_movements x),
  'returns',(select jsonb_agg(to_jsonb(x) order by x.id) from public.returns x),
  'return_items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.return_items x));
 if ledger is distinct from after_ledger then raise exception 'LEDGER_CHANGED_BY_GROUPING';end if;checks:=checks+1;
 again:=app.m9_group_provisionals(request,'QA NO COMERCIAL · agrupación temporal',members,plan->>'token','Codex QA','Ensayo técnico, sin aprobación comercial',repeat('a',64));
 if receipt<>again then raise exception 'GROUPING_REPLAY_CHANGED';end if;checks:=checks+1;
 begin
  update public.variants set woocommerce_product_id=999999999 where id=vid;
  raise exception 'GROUPED_WEB_LINK_ALLOWED';
 exception when others then if sqlerrm<>'M9_PROVISIONAL_WEB_BLOCKED' then raise;end if;end;checks:=checks+1;
 -- Return a pre-grouping sale AFTER grouping; then undo the grouping.
 insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at)
 values(actor,actor,'returns.authorize',now()+interval '5 minutes') returning id into token;
 refund:=public.create_return_exchange(return_key,sid,sale.id,jsonb_build_array(jsonb_build_object('sale_item_id',(select id from public.sale_items where sale_id=sale.id),'quantity',1,'condition','RESELLABLE')),'[]','[]','[]',token,'QA SINTETICO devolución posterior a agrupar');
 refund_again:=public.create_return_exchange(return_key,sid,sale.id,jsonb_build_array(jsonb_build_object('sale_item_id',(select id from public.sale_items where sale_id=sale.id),'quantity',1,'condition','RESELLABLE')),'[]','[]','[]',token,'QA SINTETICO devolución posterior a agrupar');
 if refund->>'id' is distinct from refund_again->>'id' or (refund->>'returned_cents')::bigint<>price
 or (select qty from public.inventory_by_location where variant_id=vid and location_id=location)<>2 then raise exception 'GROUPED_RETURN_FAILED';end if;checks:=checks+1;
 ledger:=jsonb_build_object('balances',(select jsonb_agg(to_jsonb(x) order by x.variant_id,x.location_id) from public.inventory_by_location x),
  'movements',(select jsonb_agg(to_jsonb(x) order by x.id) from public.inventory_movements x),
  'sales',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sales x),
  'sale_items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sale_items x),
  'payments',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sale_payments x),
  'cash',(select jsonb_agg(to_jsonb(x) order by x.id) from public.cash_movements x),
  'returns',(select jsonb_agg(to_jsonb(x) order by x.id) from public.returns x),
  'return_items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.return_items x));
 perform app.m9_undo_provisional_group(request,'Codex QA','Reversión técnica: conserva todas las operaciones');
 current_states:=jsonb_build_array(app.m9_provisional_state(vid),app.m9_provisional_state(other));
 -- The touch trigger legitimately records the maintenance time. Do not falsify
 -- that timestamp to make a byte comparison pass; compare all business fields.
 if (select jsonb_agg((s-'variant')||jsonb_build_object('variant',(s->'variant')-'updated_at') order by s->>'variant_id') from jsonb_array_elements(states) s)
  is distinct from (select jsonb_agg((s-'variant')||jsonb_build_object('variant',(s->'variant')-'updated_at') order by s->>'variant_id') from jsonb_array_elements(current_states) s)
 then raise exception 'UNGROUP_STATE_DIFFERS';end if;checks:=checks+1;
 after_ledger:=jsonb_build_object('balances',(select jsonb_agg(to_jsonb(x) order by x.variant_id,x.location_id) from public.inventory_by_location x),
  'movements',(select jsonb_agg(to_jsonb(x) order by x.id) from public.inventory_movements x),
  'sales',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sales x),
  'sale_items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sale_items x),
  'payments',(select jsonb_agg(to_jsonb(x) order by x.id) from public.sale_payments x),
  'cash',(select jsonb_agg(to_jsonb(x) order by x.id) from public.cash_movements x),
  'returns',(select jsonb_agg(to_jsonb(x) order by x.id) from public.returns x),
  'return_items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.return_items x));
 if ledger is distinct from after_ledger then raise exception 'LEDGER_CHANGED_BY_UNGROUPING';end if;checks:=checks+1;
 if (app.m9_undo_provisional_group(request,'Codex QA','Repetición de reversión técnica')->>'already_reversed')::boolean is distinct from true then raise exception 'UNDO_REPLAY_CHANGED';end if;checks:=checks+1;
 -- A second money flow AFTER undo also needs its normal deferred checks.
 sale:=public.create_sale(gen_random_uuid(),sid,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',1)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',price,'tendered_cents',price)));
 insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at)
 values(actor,actor,'returns.authorize',now()+interval '5 minutes') returning id into token;
 refund:=public.create_return_exchange(gen_random_uuid(),sid,sale.id,jsonb_build_array(jsonb_build_object('sale_item_id',(select id from public.sale_items where sale_id=sale.id),'quantity',1,'condition','RESELLABLE')),'[]','[]','[]',token,'QA SINTETICO devolución posterior a desagrupar');
 if (refund->>'returned_cents')::bigint<>price or (select qty from public.inventory_by_location where variant_id=vid and location_id=location)<>2 then raise exception 'UNGROUPED_RETURN_FAILED';end if;checks:=checks+1;
 if exists(select 1 from public.variants where id=any(ids) and cost_cents is not null) then raise exception 'COST_INVENTED';end if;checks:=checks+1;
 insert into grouping_results values(jsonb_build_object('checks',checks,'variant_ids_preserved',true,'literal_barcodes_preserved',true,'inventory_and_movements_preserved',true,'group_and_undo_idempotent',true,'synthetic_stock_rolled_back',true,'positive_sale_tested',true,'sale_and_refund_history_preserved',true,'refund_after_grouping',true,'refund_after_undo',true,'temporary_review_rolled_back',true));
end $qa$;
select * from grouping_results;
rollback;
