begin;
select app.assert_sicar_staging_enabled();
create table app.m9_woo_finance_reads (
 id uuid primary key default gen_random_uuid(), trial_id uuid not null references app.m9_woo_connected_trials(id),
 actor_id uuid not null references public.app_users(id), snapshot_sha256 text not null check(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 snapshot jsonb not null, review jsonb not null, observed_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),unique(trial_id,snapshot_sha256)
);
alter table app.m9_woo_finance_reads enable row level security;
revoke all on app.m9_woo_finance_reads from public,anon,authenticated,service_role;
create trigger m9_woo_finance_read_immutable before update or delete on app.m9_woo_finance_reads
 for each row execute function app.m9_woo_pilot_immutable();
create function app.m9_woo_finance_context(actor uuid,tid uuid) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare t app.m9_woo_connected_trials; catalog jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 if actor is null or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 select * into t from app.m9_woo_connected_trials where id=tid and actor_id=actor and state='VERIFIED';
 if t.id is null or t.parent_id not in ('97c82026-b3cc-4c60-8f22-13d7c00fb33a'::uuid,'ba239bba-7691-43cc-9c76-8768a1af9f21'::uuid) then raise exception 'FINANCE_TRIAL_NOT_FOUND';end if;
 select jsonb_build_object('name',p.name,'sku',v.sku,'barcode',t.expected->>'barcode','variant_id',v.id,'cost_cents',v.cost_cents)
  into catalog from public.variants v join public.products p on p.id=v.product_id join public.barcodes b on b.variant_id=v.id
  where v.id=(t.expected->>'variant_id')::uuid and b.code=t.expected->>'barcode' and b.source='SICAR' and v.price_cents=(t.expected->>'unit_price_cents')::bigint;
 if catalog is null then raise exception 'FINANCE_CATALOG_CHANGED';end if;
 return jsonb_build_object('reference',t.snapshot,'catalog',catalog,'reads',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'review',review,'observed_at',observed_at) order by created_at desc),'[]'::jsonb) from app.m9_woo_finance_reads where trial_id=tid and actor_id=actor));
end $$;
revoke all on function app.m9_woo_finance_context(uuid,uuid) from public,anon,authenticated,service_role;
create function public.m9_woo_finance_context(p_trial uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin return app.m9_woo_finance_context(app.current_user_id(),p_trial);end $$;
revoke all on function public.m9_woo_finance_context(uuid) from public,anon,service_role;
grant execute on function public.m9_woo_finance_context(uuid) to authenticated;

create function public.m9_record_woo_finance_read(p_input jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid;tid uuid;ctx jsonb;s jsonb;ref jsonb;money jsonb;pay jsonb;line jsonb;k text;expected bigint;
 observed timestamptz;h text;review jsonb;old app.m9_woo_finance_reads;rid uuid;
begin
 perform app.assert_sicar_staging_enabled();
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'FINANCE_SERVER_ONLY' using errcode='42501';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>20000 or
  (select array_agg(key_name order by key_name) from jsonb_object_keys(p_input) key_name) is distinct from array['actor_id','id','observed_at','snapshot']::text[] then raise exception 'FINANCE_INPUT_INVALID';end if;
 actor:=(p_input->>'actor_id')::uuid;tid:=(p_input->>'id')::uuid;ctx:=app.m9_woo_finance_context(actor,tid);ref:=ctx->'reference';s:=p_input->'snapshot';observed:=(p_input->>'observed_at')::timestamptz;
 if observed is null or observed<clock_timestamp()-interval '5 minutes' or observed>clock_timestamp()+interval '5 seconds' then raise exception 'FINANCE_OBSERVATION_STALE';end if;
 if jsonb_typeof(s) is distinct from 'object' or (select array_agg(key_name order by key_name) from jsonb_object_keys(s) key_name) is distinct from array['counts','currency','lines','money','payment','protocol','reference']::text[]
  or s->>'protocol' is distinct from 'm9-remote-order-finance-read-1' or s->'reference' is distinct from ref or s->>'currency' is distinct from 'MXN'
  or ref->>'status' is distinct from 'cancelled' or ref->'synthetic' is distinct from 'true'::jsonb or ref->'payment_executed' is distinct from 'false'::jsonb
  or s->'counts' is distinct from '{"coupons":0,"shipping":0,"fees":0,"refunds":0}'::jsonb
  or s->'payment' is distinct from '{"method":"m9_synthetic_no_payment","transaction_id":"","paid_at":null,"is_paid":false}'::jsonb
  or jsonb_typeof(s->'lines') is distinct from 'array' then raise exception 'FINANCE_SNAPSHOT_CHANGED';end if;
 if jsonb_array_length(s->'lines')<>1 then raise exception 'FINANCE_SNAPSHOT_CHANGED';end if;
 money:=s->'money';line:=s->'lines'->0;
 if jsonb_typeof(money) is distinct from 'object' or (select array_agg(key_name order by key_name) from jsonb_object_keys(money) key_name) is distinct from array['cart_tax','discount_total','fees_total','items_subtotal','refunded_total','shipping_tax','shipping_total','total','total_tax']::text[]
  or jsonb_typeof(line) is distinct from 'object' or (select array_agg(key_name order by key_name) from jsonb_object_keys(line) key_name) is distinct from array['line_id','subtotal','subtotal_tax','total','total_tax']::text[]
  or line->'line_id' is distinct from ref->'line_id' then raise exception 'FINANCE_SNAPSHOT_CHANGED';end if;
 expected:=(ref->>'quantity')::bigint*(ref->>'unit_price_cents')::bigint;
 for k in select jsonb_object_keys(money) loop
  if jsonb_typeof(money->k) is distinct from 'string' or money->>k !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' then raise exception 'FINANCE_DECIMAL_INVALID';end if;
  if (money->>k)::numeric*100<>(case when k in ('items_subtotal','total') then expected else 0 end) then raise exception 'FINANCE_TOTALS_CHANGED';end if;
 end loop;
 foreach k in array array['subtotal','subtotal_tax','total','total_tax'] loop
  if jsonb_typeof(line->k) is distinct from 'string' or line->>k !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' then raise exception 'FINANCE_DECIMAL_INVALID';end if;
  if (line->>k)::numeric*100<>(case when k in ('subtotal','total') then expected else 0 end) then raise exception 'FINANCE_TOTALS_CHANGED';end if;
 end loop;
 h:=encode(extensions.digest(s::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-finance-read/'||tid,0));
 select * into old from app.m9_woo_finance_reads where trial_id=tid and snapshot_sha256=h;
 if old.id is not null then return jsonb_build_object('id',old.id,'review',old.review,'replayed',true);end if;
 review:=jsonb_build_object('classification','CANCELLED_UNPAID','observed_total_cents',expected,'paid_amount_cents',null,
  'can_record_sale',false,'can_issue_sale_ticket',false,'stock_write_allowed',false,'catalog',ctx->'catalog');
 insert into app.m9_woo_finance_reads(trial_id,actor_id,snapshot_sha256,snapshot,review,observed_at) values(tid,actor,h,s,review,observed) returning id into rid;
 return jsonb_build_object('id',rid,'review',review,'replayed',false);
end $$;
revoke all on function public.m9_record_woo_finance_read(jsonb) from public,anon,authenticated;
grant execute on function public.m9_record_woo_finance_read(jsonb) to service_role;
commit;
