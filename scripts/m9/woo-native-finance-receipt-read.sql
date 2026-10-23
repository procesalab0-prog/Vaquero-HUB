-- Forward proposal: root generates/applies migration only after local acceptance.
-- Existing receipts only; no table, command, public endpoint or writer change.
begin;
select app.assert_sicar_staging_enabled();
create function app.m9_woo_native_finance_receipt(p jsonb)returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;h text;r app.m9_woo_finance_receipts;f app.m9_woo_finance_postings;
 s public.sales;e app.m9_woo_finance_test_evidence;
begin
 if current_user<>'postgres'then raise exception 'WOO_FINANCE_RECEIPT_OPERATOR_ONLY'using errcode='42501';end if;
 perform app.assert_sicar_staging_enabled();actor:=app.current_user_id();
 if actor is null or not exists(select 1 from public.app_users u join public.roles ro on ro.id=u.role_id
  where u.id=actor and u.is_active and ro.code='ADMIN')or not app.has_perm('pos.sell')
 then raise exception 'WOO_FINANCE_RECEIPT_NOT_AUTHORIZED'using errcode='42501';end if;
 if not app.m9_detail_shape(p,array['store_origin','order_id','expected_version','operation_id','action','evidence_id','evidence_sha256'])
  or octet_length(p::text)>6000
  or jsonb_typeof(p->'store_origin')is distinct from'string'or p->>'store_origin'is distinct from'https://salmon-nightingale-251188.hostingersite.com'
  or jsonb_typeof(p->'order_id')is distinct from'number'or coalesce(p->>'order_id','')!~'^[1-9][0-9]{0,15}$'or(p->>'order_id')::numeric>9007199254740991
  or jsonb_typeof(p->'expected_version')is distinct from'number'or coalesce(p->>'expected_version','')!~'^(0|[1-9][0-9]{0,14})$'
  or jsonb_typeof(p->'operation_id')is distinct from'string'or coalesce(p->>'operation_id','')!~'^[A-Za-z0-9:_-]{1,120}$'
  or jsonb_typeof(p->'action')is distinct from'string'or p->>'action'not in('POST','FULL_CANCEL')
  or jsonb_typeof(p->'evidence_id')is distinct from'string'or coalesce(p->>'evidence_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or jsonb_typeof(p->'evidence_sha256')is distinct from'string'or coalesce(p->>'evidence_sha256','')!~'^[a-f0-9]{64}$'
 then raise exception 'WOO_FINANCE_RECEIPT_PACKET_INVALID';end if;
 h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 select *into r from app.m9_woo_finance_receipts
  where origin=p->>'store_origin'and order_id=(p->>'order_id')::bigint and operation_id=p->>'operation_id';
 -- Missing includes a matching operation not yet visible at this MVCC snapshot.
 -- It never proves no effect, never permits repost and never reveals ownership.
 if r.id is null or r.actor_id is distinct from actor or r.request_sha256 is distinct from h or r.packet is distinct from p
 then raise exception 'WOO_FINANCE_RECEIPT_NOT_AVAILABLE';end if;
 select *into f from app.m9_woo_finance_postings where id=r.posting_id;
 select *into s from public.sales where id=f.sale_id;
 select *into e from app.m9_woo_finance_test_evidence where id=r.evidence_id;
 if f.id is null or s.id is null or e.id is null or f.origin is distinct from r.origin or f.order_id is distinct from r.order_id
  or not exists(select 1 from public.locations l where l.id=s.location_id and l.is_active and l.type='STORE')
  or not app.can_access_location(s.location_id)
  or e.actor_id is distinct from actor or e.origin is distinct from r.origin or e.order_id is distinct from r.order_id
  or e.gateway_mode is distinct from'SYNTHETIC_TEST_ONLY'or e.source_sha256 is distinct from p->>'evidence_sha256'
  or e.currency is distinct from'MXN'or e.total_cents is distinct from f.amount_cents
  or r.action is distinct from p->>'action'
  or(r.action='POST'and(e.kind is distinct from'PAYMENT'or f.evidence_id is distinct from e.id or f.actor_id is distinct from actor))
  or(r.action='FULL_CANCEL'and(e.kind is distinct from'FULL_CANCEL'or e.original_evidence_id is distinct from f.evidence_id))
  or not app.m9_detail_shape(r.result,array['receipt_id','posting_id','sale_id','sale_folio','order_id','action','version','amount_cents','synthetic','real_gateway_payment','cash_movement_created','replayed'])
  or r.result->'receipt_id'is distinct from to_jsonb(r.id)or r.result->'posting_id'is distinct from to_jsonb(f.id)
  or r.result->'sale_id'is distinct from to_jsonb(s.id)or r.result->'sale_folio'is distinct from to_jsonb(s.folio)
  or r.result->'order_id'is distinct from to_jsonb(r.order_id)or r.result->'action'is distinct from to_jsonb(r.action)
  or r.result->'version'is distinct from to_jsonb((p->>'expected_version')::bigint+1)
  or r.result->'amount_cents'is distinct from to_jsonb(f.amount_cents)
  or r.result->'synthetic'is distinct from'true'::jsonb or r.result->'real_gateway_payment'is distinct from'false'::jsonb
  or r.result->'cash_movement_created'is distinct from'false'::jsonb or r.result->'replayed'is distinct from'false'::jsonb
 then raise exception 'WOO_FINANCE_RECEIPT_NOT_AVAILABLE';end if;
 return jsonb_build_object('receipt',r.result,'created_at',r.created_at,'current_sale_status',s.status,
  'historical_receipt',true,'read_only',true,'write_executed',false,'repost_allowed',false,
  'synthetic',true,'real_gateway_payment',false);
end $$;
revoke all on function app.m9_woo_native_finance_receipt(jsonb)from public,anon,authenticated,service_role;
comment on function app.m9_woo_native_finance_receipt(jsonb)is 'STAGING MAINTENANCE ONLY: read an existing own exact synthetic native-finance receipt after window/session close; absence is not proof of no effect. Never reposts or authorizes payment.';
commit;
