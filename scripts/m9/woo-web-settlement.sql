-- Proposed forward SQL, NOT an applied migration. Coordinator owns staging DDL.
-- Private SYNTHETIC_TEST_ONLY ledger. No native sales, stock, cash or provider IO.
begin;
select app.assert_sicar_staging_enabled();
create table app.m9_web_settlement_control(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 project_ref text not null default 'zsezjtswqeijboezvado' check(project_ref='zsezjtswqeijboezvado'),
 actor_id uuid references public.app_users(id),expires_at timestamptz,
 check(not enabled or(actor_id is not null and expires_at is not null))
);
insert into app.m9_web_settlement_control(singleton)values(true);
create table app.m9_web_order_snapshots(
 id uuid primary key default gen_random_uuid(),provider text not null,account_id text not null,merchant_id text not null,
 origin text not null check(origin='https://salmon-nightingale-251188.hostingersite.com'),order_id bigint not null check(order_id>0),currency text not null check(currency='MXN'),
 revision bigint not null check(revision>=0),commercial_sha256 text not null check(commercial_sha256~'^[a-f0-9]{64}$'),
 document jsonb not null,total_cents bigint not null check(total_cents>0),actor_id uuid not null references public.app_users(id),created_at timestamptz not null default clock_timestamp(),
 unique(provider,account_id,merchant_id,origin,order_id,currency,revision)
);
create index m9_web_order_actor_idx on app.m9_web_order_snapshots(actor_id);
create table app.m9_web_settlement_events(
 id uuid primary key default gen_random_uuid(),snapshot_id uuid not null references app.m9_web_order_snapshots(id),
 provider text not null,account_id text not null,merchant_id text not null,origin text not null,order_id bigint not null,currency text not null check(currency='MXN'),
 evidence_trust text not null check(evidence_trust='SYNTHETIC_TEST_ONLY'),
 kind text not null check(kind in('AUTHORIZATION','VOID','CAPTURE','REFUND','PROVIDER_FEE','FEE_REVERSAL','SETTLEMENT','PHYSICAL_RECEIPT')),
 event_reference text not null check(event_reference~'^SYNTHETIC-[A-Za-z0-9:_-]{1,100}$'),
 transaction_reference text check(transaction_reference~'^SYNTHETIC-[A-Za-z0-9:_-]{1,100}$'),
 related_event_id uuid references app.m9_web_settlement_events(id),amount_cents bigint not null check(amount_cents>=0),
 source_sha256 text not null check(source_sha256~'^[a-f0-9]{64}$'),occurred_at timestamptz not null,observed_at timestamptz not null,
 physical_lines jsonb not null,settlement_components jsonb,actor_id uuid not null references public.app_users(id),created_at timestamptz not null default clock_timestamp(),
 unique(provider,account_id,event_reference),unique(provider,account_id,merchant_id,origin,order_id,currency,event_reference),
 check((kind='PHYSICAL_RECEIPT' and amount_cents=0 and transaction_reference is null)or(kind<>'PHYSICAL_RECEIPT' and amount_cents>0 and transaction_reference is not null))
);
create index m9_web_event_scope_idx on app.m9_web_settlement_events(provider,account_id,merchant_id,origin,order_id,currency,kind);
create index m9_web_event_snapshot_idx on app.m9_web_settlement_events(snapshot_id);
create index m9_web_event_related_idx on app.m9_web_settlement_events(related_event_id);
create index m9_web_event_actor_idx on app.m9_web_settlement_events(actor_id);
create unique index m9_web_unique_monetary_transaction on app.m9_web_settlement_events(provider,account_id,kind,transaction_reference)
 where kind in('CAPTURE','REFUND','PROVIDER_FEE','FEE_REVERSAL','SETTLEMENT');
create table app.m9_web_settlement_journal(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references app.m9_web_settlement_events(id),
 account text not null check(account in('PROVIDER_CLEARING','ORDER_FUNDS','PROVIDER_FEE_EXPENSE','SETTLEMENT_PENDING')),
 debit_cents bigint not null check(debit_cents>=0),credit_cents bigint not null check(credit_cents>=0),
 created_at timestamptz not null default clock_timestamp(),unique(event_id,account),
 check((debit_cents>0 and credit_cents=0)or(credit_cents>0 and debit_cents=0))
);
create table app.m9_web_settlement_receipts(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.app_users(id),operation_id uuid not null,
 event_id uuid not null unique references app.m9_web_settlement_events(id),request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 result jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(actor_id,operation_id)
);

create function app.m9_web_settlement_immutable()returns trigger language plpgsql security invoker set search_path=''as $$
begin raise exception 'WEB_SETTLEMENT_IMMUTABLE';end$$;
create function app.m9_web_journal_balanced()returns trigger language plpgsql security invoker set search_path=''as $$
declare deb numeric;cred numeric;n int;k text;a bigint;eid uuid;
begin
 eid:=case when tg_table_name='m9_web_settlement_events'then(to_jsonb(new)->>'id')::uuid else(to_jsonb(new)->>'event_id')::uuid end;
 select coalesce(sum(debit_cents),0),coalesce(sum(credit_cents),0),count(*)into deb,cred,n from app.m9_web_settlement_journal where event_id=eid;
 select kind,amount_cents into strict k,a from app.m9_web_settlement_events where id=eid;
 if deb<>cred or(k in('CAPTURE','REFUND','PROVIDER_FEE','FEE_REVERSAL','SETTLEMENT')and(n<>2 or deb<>a))or(k not in('CAPTURE','REFUND','PROVIDER_FEE','FEE_REVERSAL','SETTLEMENT')and n<>0)then raise exception 'WEB_JOURNAL_UNBALANCED';end if;
 return new;
end$$;
create constraint trigger m9_web_journal_balanced after insert on app.m9_web_settlement_journal deferrable initially deferred for each row execute function app.m9_web_journal_balanced();
create constraint trigger m9_web_event_journal_balanced after insert on app.m9_web_settlement_events deferrable initially deferred for each row execute function app.m9_web_journal_balanced();
do $$declare t text;begin
 foreach t in array array['m9_web_settlement_control','m9_web_order_snapshots','m9_web_settlement_events','m9_web_settlement_journal','m9_web_settlement_receipts']loop
 execute format('alter table app.%I enable row level security',t);execute format('revoke all on app.%I from public,anon,authenticated,service_role',t);
 if t<>'m9_web_settlement_control'then execute format('create trigger %I before update or delete on app.%I for each row execute function app.m9_web_settlement_immutable()',t||'_immutable',t);end if;
 end loop;
end$$;

create function app.m9_web_settlement_actor()returns uuid language plpgsql security invoker set search_path=''as $$
declare a uuid;
begin
 if current_user<>'postgres'then raise exception 'WEB_SETTLEMENT_MAINTENANCE_ONLY'using errcode='42501';end if;
 a:=app.m9_legacy_actor();
 if not exists(select 1 from app.m9_web_settlement_control where singleton and project_ref='zsezjtswqeijboezvado')then raise exception 'WEB_SETTLEMENT_TARGET_REQUIRED'using errcode='42501';end if;
 return a;
end$$;
create function app.m9_web_timestamp(v jsonb)returns timestamptz language plpgsql immutable security invoker set search_path=''as $$
declare t timestamptz;s text:=v#>>'{}';
begin
 if jsonb_typeof(v)is distinct from'string'or s!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'then raise exception 'WEB_TIMESTAMP_INVALID';end if;
 begin t:=s::timestamptz;exception when others then raise exception 'WEB_TIMESTAMP_INVALID';end;
 if to_char(t at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>s then raise exception 'WEB_TIMESTAMP_INVALID';end if;return t;
end$$;
create function app.m9_web_order_total(d jsonb)returns bigint language plpgsql immutable security invoker set search_path=''as $$
declare m jsonb;l jsonb;v bigint;subtotal numeric:=0;line_total numeric:=0;line_tax numeric:=0;k text;
begin
 if not app.m9_detail_shape(d,array['revision','components','lines'])or jsonb_typeof(d->'revision')is distinct from'number'or coalesce(d->>'revision','')!~'^(0|[1-9][0-9]{0,14})$'or
  not app.m9_detail_shape(d->'components',array['items_subtotal','discount_total','shipping_total','shipping_tax','cart_tax','total_tax','fees_total','fee_tax','total'])or
  jsonb_typeof(d->'lines')is distinct from'array'or jsonb_array_length(d->'lines')not between 1 and 50 then raise exception 'WEB_ORDER_DOCUMENT_INVALID';end if;
 m:=d->'components';foreach k in array array['items_subtotal','discount_total','shipping_total','shipping_tax','cart_tax','total_tax','fees_total','fee_tax','total']loop v:=app.m9_detail_amount(m->k);end loop;
 for l in select value from jsonb_array_elements(d->'lines')loop
  if not app.m9_detail_shape(l,array['line_id','product_id','variation_id','barcode','quantity','subtotal_cents','total_cents','subtotal_tax_cents','total_tax_cents'])or
   jsonb_typeof(l->'line_id')is distinct from'number'or coalesce(l->>'line_id','')!~'^[1-9][0-9]{0,15}$'or (l->>'line_id')::numeric>9007199254740991 or
   jsonb_typeof(l->'product_id')is distinct from'number'or coalesce(l->>'product_id','')!~'^[1-9][0-9]{0,15}$'or (l->>'product_id')::numeric>9007199254740991 or
   jsonb_typeof(l->'variation_id')is distinct from'number'or coalesce(l->>'variation_id','')!~'^(0|[1-9][0-9]{0,15})$'or (l->>'variation_id')::numeric>9007199254740991 or
   jsonb_typeof(l->'quantity')is distinct from'number'or coalesce(l->>'quantity','')!~'^[1-9][0-9]{0,8}$'or
   jsonb_typeof(l->'barcode')is distinct from'string'or length(l->>'barcode')not between 1 and 160 or l->>'barcode'<>btrim(l->>'barcode')or(l->>'barcode')~'[[:cntrl:]]'then raise exception 'WEB_ORDER_LINE_INVALID';end if;
  if app.m9_detail_amount(l->'total_cents')>app.m9_detail_amount(l->'subtotal_cents')or app.m9_detail_amount(l->'total_tax_cents')>app.m9_detail_amount(l->'subtotal_tax_cents')then raise exception 'WEB_ORDER_LINE_TOTALS_INVALID';end if;
  subtotal:=subtotal+app.m9_detail_amount(l->'subtotal_cents');line_total:=line_total+app.m9_detail_amount(l->'total_cents');line_tax:=line_tax+app.m9_detail_amount(l->'total_tax_cents');
 end loop;
 if(select count(distinct x->>'line_id')from jsonb_array_elements(d->'lines')x)<>jsonb_array_length(d->'lines')or(select count(distinct(x->>'product_id',x->>'variation_id'))from jsonb_array_elements(d->'lines')x)<>jsonb_array_length(d->'lines')or(select count(distinct x->>'barcode')from jsonb_array_elements(d->'lines')x)<>jsonb_array_length(d->'lines')then raise exception 'WEB_ORDER_DUPLICATE_LINE';end if;
 if subtotal<>app.m9_detail_amount(m->'items_subtotal')or subtotal-line_total<>app.m9_detail_amount(m->'discount_total')or line_tax+app.m9_detail_amount(m->'fee_tax')<>app.m9_detail_amount(m->'cart_tax')or
  app.m9_detail_amount(m->'cart_tax')+app.m9_detail_amount(m->'shipping_tax')<>app.m9_detail_amount(m->'total_tax')or line_total+app.m9_detail_amount(m->'shipping_total')+app.m9_detail_amount(m->'fees_total')+app.m9_detail_amount(m->'total_tax')<>app.m9_detail_amount(m->'total')or app.m9_detail_amount(m->'total')<=0 then raise exception 'WEB_ORDER_COMPONENTS_DIFFER';end if;
 return app.m9_detail_amount(m->'total');
end$$;

create function app.m9_web_settlement_balance(sid uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 with scope as(select *from app.m9_web_order_snapshots where id=sid),s as(
 select coalesce(sum(amount_cents)filter(where kind='AUTHORIZATION'),0)::numeric authorized,
 coalesce(sum(amount_cents)filter(where kind='VOID'),0)::numeric voided,
 coalesce(sum(amount_cents)filter(where kind='CAPTURE'),0)::numeric captured,
 coalesce(sum(amount_cents)filter(where kind='REFUND'),0)::numeric refunded,
 coalesce(sum(amount_cents)filter(where kind='PROVIDER_FEE'),0)::numeric fees,
 coalesce(sum(amount_cents)filter(where kind='FEE_REVERSAL'),0)::numeric fee_reversals,
 coalesce(sum(amount_cents)filter(where kind='SETTLEMENT'),0)::numeric settled
 from app.m9_web_settlement_events e join scope s on(e.provider,e.account_id,e.merchant_id,e.origin,e.order_id,e.currency)=(s.provider,s.account_id,s.merchant_id,s.origin,s.order_id,s.currency))
 select jsonb_build_object('authorized_cents',authorized,'voided_cents',voided,'captured_cents',captured,'refunded_cents',refunded,'provider_fees_cents',fees,'fee_reversals_cents',fee_reversals,'settlement_pending_cents',settled,
 'clearing_cents',captured-refunded-fees+fee_reversals-settled,'order_funds_cents',captured-refunded,'bank_verified',false,'native_sale_recorded',false,'stock_changed',false,'synthetic',true)from s;
$$;

create function app.m9_web_settlement_receipt(op uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare actor uuid:=app.m9_web_settlement_actor();r app.m9_web_settlement_receipts;
begin
 if op is null then raise exception 'WEB_OPERATION_REQUIRED';end if;
 select *into r from app.m9_web_settlement_receipts where actor_id=actor and operation_id=op;
 if r.id is null then raise exception 'WEB_RECEIPT_NOT_FOUND';end if;
 return r.result||jsonb_build_object('receipt_id',r.id,'created_at',r.created_at,'replayed',true,'lookup_only',true);
end$$;

create function app.m9_web_settlement_record(p jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare actor uuid:=app.m9_web_settlement_actor();c app.m9_web_settlement_control;r app.m9_web_settlement_receipts;e jsonb;d jsonb;s app.m9_web_order_snapshots;related app.m9_web_settlement_events;
 op uuid;h text;commercial text;oid bigint;total bigint;amount bigint;observed timestamptz;occurred timestamptz;eid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();scope text;k text;b jsonb;used numeric;line jsonb;n numeric;debit text;credit text;result jsonb;cnt int;expected_statement jsonb;
begin
 if not app.m9_detail_shape(p,array['protocol','mode','operation_id','evidence'])or p->>'protocol'is distinct from'm9-web-settlement-synthetic-1'or p->>'mode'is distinct from'SYNTHETIC_TEST_ONLY'or
  jsonb_typeof(p->'operation_id')is distinct from'string'or coalesce(p->>'operation_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'then raise exception 'WEB_PACKET_INVALID';end if;
 op:=(p->>'operation_id')::uuid;h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-web-operation:'||actor::text||':'||op::text,0));
 select *into r from app.m9_web_settlement_receipts where actor_id=actor and operation_id=op;
 if r.id is not null then if r.request_sha256<>h then raise exception 'WEB_OPERATION_REUSED';end if;return r.result||jsonb_build_object('replayed',true);end if;
 select *into strict c from app.m9_web_settlement_control where singleton for share;
 if not c.enabled or c.actor_id is distinct from actor or c.expires_at<=clock_timestamp()or c.expires_at>clock_timestamp()+interval'15 minutes'then raise exception 'WEB_SETTLEMENT_DISABLED'using errcode='42501';end if;
 e:=p->'evidence';
 if not app.m9_detail_shape(e,array['provider','account_id','merchant_id','origin','order_id','currency','kind','event_reference','transaction_reference','related_event_id','amount_cents','source_sha256','occurred_at','observed_at','order_document','physical_lines','settlement_components'])then raise exception 'WEB_EVIDENCE_INVALID';end if;
 foreach k in array array['provider','account_id','merchant_id']loop if jsonb_typeof(e->k)is distinct from'string'or length(e->>k)not between 1 and 100 or e->>k<>btrim(e->>k)or(e->>k)~'[[:cntrl:]]'then raise exception 'WEB_PROVIDER_SCOPE_INVALID';end if;end loop;
 if e->>'origin'is distinct from'https://salmon-nightingale-251188.hostingersite.com'or e->>'currency'is distinct from'MXN'or jsonb_typeof(e->'order_id')is distinct from'number'or coalesce(e->>'order_id','')!~'^[1-9][0-9]{0,15}$'or(e->>'order_id')::numeric>9007199254740991 then raise exception 'WEB_TEST_ORDER_REQUIRED';end if;
 if jsonb_typeof(e->'kind')is distinct from'string'or e->>'kind'not in('AUTHORIZATION','VOID','CAPTURE','REFUND','PROVIDER_FEE','FEE_REVERSAL','SETTLEMENT','PHYSICAL_RECEIPT')or
  jsonb_typeof(e->'event_reference')is distinct from'string'or coalesce(e->>'event_reference','')!~'^SYNTHETIC-[A-Za-z0-9:_-]{1,100}$'or jsonb_typeof(e->'source_sha256')is distinct from'string'or coalesce(e->>'source_sha256','')!~'^[a-f0-9]{64}$'then raise exception 'WEB_SYNTHETIC_EVIDENCE_REQUIRED';end if;
 if(e->'transaction_reference'<>'null'and(jsonb_typeof(e->'transaction_reference')is distinct from'string'or coalesce(e->>'transaction_reference','')!~'^SYNTHETIC-[A-Za-z0-9:_-]{1,100}$'))or(e->'related_event_id'<>'null'and(jsonb_typeof(e->'related_event_id')is distinct from'string'or coalesce(e->>'related_event_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'))then raise exception 'WEB_CAUSAL_REFERENCE_INVALID';end if;
 observed:=app.m9_web_timestamp(e->'observed_at');occurred:=app.m9_web_timestamp(e->'occurred_at');
 if observed<clock_timestamp()-interval'5 minutes'or observed>clock_timestamp()+interval'5 seconds'or occurred>observed then raise exception 'WEB_EVIDENCE_STALE_OR_FUTURE';end if;
 amount:=app.m9_detail_amount(e->'amount_cents');oid:=(e->>'order_id')::bigint;d:=e->'order_document';total:=app.m9_web_order_total(d);
 commercial:=encode(extensions.digest(convert_to((d-'revision')::text,'UTF8'),'sha256'),'hex');scope:=jsonb_build_array(e->>'provider',e->>'account_id',e->>'merchant_id',e->>'origin',oid,e->>'currency')::text;
 perform pg_advisory_xact_lock(hashtextextended('m9-web-reference:'||jsonb_build_array(e->>'provider',e->>'account_id',e->>'event_reference')::text,0));
 if e->>'kind'in('CAPTURE','REFUND','PROVIDER_FEE','FEE_REVERSAL','SETTLEMENT')then
  perform pg_advisory_xact_lock(hashtextextended('m9-web-transaction:'||jsonb_build_array(e->>'provider',e->>'account_id',e->>'kind',e->>'transaction_reference')::text,0));
  if exists(select 1 from app.m9_web_settlement_events ev where ev.provider=e->>'provider'and ev.account_id=e->>'account_id'and ev.kind=e->>'kind'and ev.transaction_reference=e->>'transaction_reference')then raise exception 'WEB_MONETARY_TRANSACTION_REUSED';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-web-scope:'||scope,0));
 if exists(select 1 from app.m9_web_settlement_events where provider=e->>'provider'and account_id=e->>'account_id'and event_reference=e->>'event_reference')then raise exception 'WEB_EVENT_REFERENCE_REUSED';end if;
 select *into s from app.m9_web_order_snapshots where(provider,account_id,merchant_id,origin,order_id,currency,revision)=(e->>'provider',e->>'account_id',e->>'merchant_id',e->>'origin',oid,e->>'currency',(d->>'revision')::bigint);
 if s.id is not null and(s.commercial_sha256<>commercial or s.document<>d)then raise exception 'WEB_ORDER_REVISION_CHANGED';end if;
 if exists(select 1 from app.m9_web_order_snapshots old join app.m9_web_settlement_events ev on ev.snapshot_id=old.id where(old.provider,old.account_id,old.merchant_id,old.origin,old.order_id,old.currency)=(e->>'provider',e->>'account_id',e->>'merchant_id',e->>'origin',oid,e->>'currency')and old.commercial_sha256<>commercial)then raise exception 'WEB_ORDER_CHANGED_AFTER_EVENT';end if;
 if s.id is null then insert into app.m9_web_order_snapshots(provider,account_id,merchant_id,origin,order_id,currency,revision,commercial_sha256,document,total_cents,actor_id)values(e->>'provider',e->>'account_id',e->>'merchant_id',e->>'origin',oid,e->>'currency',(d->>'revision')::bigint,commercial,d,total,actor)returning *into s;end if;
 if e->'related_event_id'<>'null'then
  select *into related from app.m9_web_settlement_events where id=(e->>'related_event_id')::uuid;
  if related.id is null or(related.provider,related.account_id,related.merchant_id,related.origin,related.order_id,related.currency)is distinct from(e->>'provider',e->>'account_id',e->>'merchant_id',e->>'origin',oid,e->>'currency')or related.occurred_at>occurred then raise exception 'WEB_RELATED_EVENT_SCOPE_INVALID';end if;
 end if;
 b:=app.m9_web_settlement_balance(s.id);k:=e->>'kind';
 select coalesce(sum(amount_cents),0)into used from app.m9_web_settlement_events ev where(ev.provider,ev.account_id,ev.merchant_id,ev.origin,ev.order_id,ev.currency)=(s.provider,s.account_id,s.merchant_id,s.origin,s.order_id,s.currency)and ev.kind=k;
 if used+amount>9007199254740991 or abs((b->>'clearing_cents')::numeric+case when k in('CAPTURE','FEE_REVERSAL')then amount when k in('REFUND','PROVIDER_FEE','SETTLEMENT')then-amount else 0 end)>9007199254740991 then raise exception 'WEB_AMOUNT_TOTAL_OVERFLOW';end if;
 if jsonb_typeof(e->'physical_lines')is distinct from'array'or(k<>'PHYSICAL_RECEIPT'and e->'physical_lines'<>'[]')or(k<>'SETTLEMENT'and e->'settlement_components'<>'null')then raise exception 'WEB_UNEXPECTED_COMPONENTS';end if;
 if k='PHYSICAL_RECEIPT'then
  if amount<>0 or e->'transaction_reference'<>'null'or e->'related_event_id'<>'null'or jsonb_array_length(e->'physical_lines')not between 1 and 50 then raise exception 'WEB_PHYSICAL_RECEIPT_INVALID';end if;
  if(select count(distinct x->>'line_id')from jsonb_array_elements(e->'physical_lines')x)<>jsonb_array_length(e->'physical_lines')then raise exception 'WEB_PHYSICAL_DUPLICATE_LINE';end if;
  for line in select value from jsonb_array_elements(e->'physical_lines')loop
   if not app.m9_detail_shape(line,array['line_id','barcode','quantity'])or jsonb_typeof(line->'line_id')is distinct from'number'or coalesce(line->>'line_id','')!~'^[1-9][0-9]{0,15}$'or jsonb_typeof(line->'quantity')is distinct from'number'or coalesce(line->>'quantity','')!~'^[1-9][0-9]{0,8}$'or jsonb_typeof(line->'barcode')is distinct from'string'then raise exception 'WEB_PHYSICAL_RECEIPT_INVALID';end if;
   select(x->>'quantity')::numeric into n from jsonb_array_elements(d->'lines')x where x->'line_id'=line->'line_id'and x->'barcode'=line->'barcode';
   if n is null then raise exception 'WEB_PHYSICAL_IDENTITY_CHANGED';end if;
   select coalesce(sum((x->>'quantity')::numeric),0)into used from app.m9_web_settlement_events ev cross join lateral jsonb_array_elements(ev.physical_lines)x where(ev.provider,ev.account_id,ev.merchant_id,ev.origin,ev.order_id,ev.currency)=(s.provider,s.account_id,s.merchant_id,s.origin,s.order_id,s.currency)and ev.kind='PHYSICAL_RECEIPT'and x->'line_id'=line->'line_id';
   if used+(line->>'quantity')::numeric>n then raise exception 'WEB_PHYSICAL_QUANTITY_EXCEEDED';end if;
  end loop;
 else
  if amount<=0 or e->'transaction_reference'='null'then raise exception 'WEB_MONETARY_AMOUNT_REQUIRED';end if;
  if k='AUTHORIZATION'then
   if related.id is not null or amount>total or(b->>'authorized_cents')::numeric-(b->>'voided_cents')::numeric+amount>total then raise exception 'WEB_AUTHORIZATION_LIMIT';end if;
  elsif k='VOID'then
   if related.kind is distinct from'AUTHORIZATION'then raise exception 'WEB_AUTHORIZATION_REQUIRED';end if;
   select coalesce(sum(amount_cents),0)into used from app.m9_web_settlement_events where related_event_id=related.id and kind in('CAPTURE','VOID');
   if used+amount>related.amount_cents then raise exception 'WEB_AUTHORIZATION_LIMIT';end if;
  elsif k='CAPTURE'then
   if(b->>'captured_cents')::numeric+amount>total then raise exception 'WEB_CAPTURE_LIMIT';end if;
   if related.id is not null then
    if related.kind<>'AUTHORIZATION'then raise exception 'WEB_AUTHORIZATION_REQUIRED';end if;
    select coalesce(sum(amount_cents),0)into used from app.m9_web_settlement_events where related_event_id=related.id and kind in('CAPTURE','VOID');
    if used+amount>related.amount_cents then raise exception 'WEB_AUTHORIZATION_LIMIT';end if;
   end if;debit:='PROVIDER_CLEARING';credit:='ORDER_FUNDS';
  elsif k in('REFUND','PROVIDER_FEE')then
   if related.kind is distinct from'CAPTURE'then raise exception 'WEB_CAPTURE_REFERENCE_REQUIRED';end if;
   if k='REFUND'then
    select coalesce(sum(amount_cents),0)into used from app.m9_web_settlement_events where related_event_id=related.id and kind='REFUND';
    if used+amount>related.amount_cents then raise exception 'WEB_REFUND_LIMIT';end if;debit:='ORDER_FUNDS';credit:='PROVIDER_CLEARING';
   else debit:='PROVIDER_FEE_EXPENSE';credit:='PROVIDER_CLEARING';end if;
  elsif k='FEE_REVERSAL'then
   if related.kind is distinct from'PROVIDER_FEE'then raise exception 'WEB_FEE_REFERENCE_REQUIRED';end if;
   select coalesce(sum(amount_cents),0)into used from app.m9_web_settlement_events where related_event_id=related.id and kind='FEE_REVERSAL';
   if used+amount>related.amount_cents then raise exception 'WEB_FEE_REVERSAL_LIMIT';end if;debit:='PROVIDER_CLEARING';credit:='PROVIDER_FEE_EXPENSE';
  elsif k='SETTLEMENT'then
   expected_statement:=jsonb_build_object('captured_cents',b->'captured_cents','refunded_cents',b->'refunded_cents','provider_fees_cents',b->'provider_fees_cents','fee_reversals_cents',b->'fee_reversals_cents','prior_settlements_cents',b->'settlement_pending_cents','net_cents',b->'clearing_cents');
   if related.id is not null or e->'settlement_components'is distinct from expected_statement or amount::numeric<>(b->>'clearing_cents')::numeric then raise exception 'WEB_NET_SETTLEMENT_REVIEW_REQUIRED';end if;debit:='SETTLEMENT_PENDING';credit:='PROVIDER_CLEARING';
  end if;
 end if;
 insert into app.m9_web_settlement_events(id,snapshot_id,provider,account_id,merchant_id,origin,order_id,currency,evidence_trust,kind,event_reference,transaction_reference,related_event_id,amount_cents,source_sha256,occurred_at,observed_at,physical_lines,settlement_components,actor_id)
 values(eid,s.id,s.provider,s.account_id,s.merchant_id,s.origin,s.order_id,s.currency,'SYNTHETIC_TEST_ONLY',k,e->>'event_reference',e->>'transaction_reference',related.id,amount,e->>'source_sha256',occurred,observed,e->'physical_lines',nullif(e->'settlement_components','null'),actor);
 if debit is not null then
  insert into app.m9_web_settlement_journal(event_id,account,debit_cents,credit_cents)values(eid,debit,amount,0),(eid,credit,0,amount);
  select count(*)into cnt from app.m9_web_settlement_journal where event_id=eid;
  if cnt<>2 or exists(select 1 from app.m9_web_settlement_journal where event_id=eid group by event_id having sum(debit_cents)<>sum(credit_cents))then raise exception 'WEB_JOURNAL_UNBALANCED';end if;
 end if;
 result:=jsonb_build_object('receipt_id',rid,'event_id',eid,'snapshot_id',s.id,'kind',k,'amount_cents',amount,'balance',app.m9_web_settlement_balance(s.id),'synthetic',true,'source_authenticated',false,'operational_authorization',false,'provider_connected',false,'can_record_sale',false,'can_issue_sale_ticket',false,'stock_write_allowed',false,'cash_movement_created',false,'replayed',false);
 insert into app.m9_web_settlement_receipts(id,actor_id,operation_id,event_id,request_sha256,result)values(rid,actor,op,eid,h,result);return result;
end$$;
revoke all on function app.m9_web_settlement_immutable(),app.m9_web_journal_balanced(),app.m9_web_settlement_actor(),app.m9_web_timestamp(jsonb),app.m9_web_order_total(jsonb),app.m9_web_settlement_balance(uuid),app.m9_web_settlement_receipt(uuid),app.m9_web_settlement_record(jsonb)from public,anon,authenticated,service_role;
comment on function app.m9_web_settlement_record(jsonb)is'PRIVATE MAINTENANCE STAGING ONLY. Immutable SYNTHETIC_TEST_ONLY web ledger independent of physical cash. Not a provider adapter, authenticated payment, sale or stock command.';
commit;
