begin;

-- Forward-only: old financial documents and inventory movements are untouched.
create function public.create_catalog_category(p_name text, p_size_scale_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_category public.categories%rowtype;
begin
 if app.current_user_id() is null or not app.has_perm('products.create') then
  raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
  raise exception 'INVALID_CATEGORY_NAME' using errcode='22023'; end if;
 insert into public.categories(name,default_size_scale_code)
 values(btrim(p_name),nullif(btrim(p_size_scale_code),'')) returning * into v_category;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,after_data)
 values(app.current_user_id(),'category.created','categories',v_category.id::text,to_jsonb(v_category));
 return jsonb_build_object('id',v_category.id,'name',v_category.name,'default_size_scale_code',v_category.default_size_scale_code);
end;
$$;
revoke all on function public.create_catalog_category(text,text) from public,anon,service_role;
grant execute on function public.create_catalog_category(text,text) to authenticated;

create table public.manual_stock_entries (
 id uuid primary key, location_id uuid not null references public.locations(id),
 actor_user_id uuid not null references public.app_users(id), items jsonb not null,
 note text not null, created_at timestamptz not null default now()
);
alter table public.manual_stock_entries enable row level security;
revoke all on public.manual_stock_entries from public,anon,authenticated,service_role;
create function public.add_manual_stock(p_id uuid,p_location_id uuid,p_items jsonb,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app.current_user_id(); v_existing public.manual_stock_entries%rowtype;
 v_item jsonb; v_qty numeric; v_previous numeric; v_cost bigint; v_variant uuid;
begin
 if v_actor is null or not app.has_perm('inventory.adjust') or not app.can_access_location(p_location_id) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_id is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 500
  or p_note is null or char_length(btrim(p_note)) not between 3 and 500 then raise exception 'INVALID_STOCK_ENTRY' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,912));
 select * into v_existing from public.manual_stock_entries where id=p_id;
 if found then
  if v_existing.actor_user_id<>v_actor or v_existing.location_id<>p_location_id or v_existing.items<>p_items or v_existing.note<>btrim(p_note) then
   raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
  return jsonb_build_object('ok',true,'count',jsonb_array_length(p_items),'repeated',true);
 end if;
 if exists(select 1 from jsonb_array_elements(p_items) x group by x->>'variant_id' having count(*)>1) then
  raise exception 'DUPLICATE_VARIANT' using errcode='22023'; end if;
 -- Every writer locks the variant before its balance; stable order avoids batch deadlocks.
 for v_item in select value from jsonb_array_elements(p_items) order by value->>'variant_id' loop
  v_variant:=(v_item->>'variant_id')::uuid; v_qty:=(v_item->>'qty')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>999999999.999 or v_qty<>round(v_qty,3)
   or v_item->>'expected_qty' is null then raise exception 'INVALID_STOCK_ENTRY' using errcode='22023'; end if;
  select cost_cents into v_cost from public.variants where id=v_variant and is_active for update;
  if not found then raise exception 'VARIANT_NOT_FOUND' using errcode='22023'; end if;
  select qty into v_previous from public.inventory_by_location where variant_id=v_variant and location_id=p_location_id for update;
  v_previous:=coalesce(v_previous,0);
  if v_previous<>(v_item->>'expected_qty')::numeric then raise exception 'STALE_INVENTORY' using errcode='40001'; end if;
  perform app.apply_movement(v_variant,p_location_id,'ADJUSTMENT',v_qty,'MANUAL_STOCK_ENTRY',p_id::text,
   jsonb_build_object('reason','ENTRADA_MANUAL','note',btrim(p_note),'unit_cost_cents',v_cost,'valuation_only',true));
 end loop;
 perform set_config('app.october_write','on',true);
 insert into public.manual_stock_entries values(p_id,p_location_id,v_actor,p_items,btrim(p_note),now());
 perform set_config('app.october_write','off',true);
 return jsonb_build_object('ok',true,'count',jsonb_array_length(p_items),'repeated',false);
end;
$$;
revoke all on function public.add_manual_stock(uuid,uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.add_manual_stock(uuid,uuid,jsonb,text) to authenticated;

alter table public.sale_payments add column card_kind text;
-- Existing receipts remain unspecified; no historical document is rewritten.
alter table public.sale_payments add constraint sale_payment_card_kind_valid check (
 (method_code='CARD' and (card_kind is null or card_kind in ('CREDIT','DEBIT')))
 or (method_code<>'CARD' and card_kind is null));
create function app.october_replace(p_source text,p_old text,p_new text) returns text
language plpgsql set search_path='' as $$begin
 if strpos(p_source,p_old)=0 then raise exception 'OCTOBER_MIGRATION_SOURCE_CHANGED: %',left(p_old,90); end if;
 return replace(p_source,p_old,p_new);
end;$$;
do $patch$
declare s text;
begin
 s:=pg_get_functiondef('app.create_sale_engine(uuid,uuid,jsonb,jsonb,uuid,jsonb,text,uuid)'::regprocedure);
 s:=app.october_replace(s,$old$if exists (select 1 from jsonb_array_elements(p_payments) i group by i->>'method_code' having count(*)>1)$old$,
 $new$if exists (select 1 from jsonb_array_elements(p_payments) i where
  (upper(i->>'method_code')='CARD' and i ? 'card_kind' and coalesce(i->>'card_kind','') not in ('CREDIT','DEBIT'))
  or (upper(i->>'method_code')<>'CARD' and i ? 'card_kind')) then raise exception 'INVALID_CARD_KIND' using errcode='22023'; end if;
 if exists (select 1 from jsonb_array_elements(p_payments) i group by upper(i->>'method_code'),
  case when upper(i->>'method_code')='CARD' then coalesce(i->>'card_kind','UNSPECIFIED') else '' end having count(*)>1)
 or exists(select 1 from jsonb_array_elements(p_payments) i where upper(i->>'method_code')='CARD'
  group by upper(i->>'method_code') having count(*)>1 and bool_or(not (i ? 'card_kind')))$new$);
 s:=app.october_replace(s,'insert into public.sale_payments(sale_id,method_code,amount_cents,reference)',
 'insert into public.sale_payments(sale_id,method_code,amount_cents,reference,card_kind)');
 s:=app.october_replace(s,$old$values(v_sale.id,v_method.code,v_amount,btrim(v_payment->>'reference'));$old$,
 $new$values(v_sale.id,v_method.code,v_amount,btrim(v_payment->>'reference'),case when v_method.code='CARD' then v_payment->>'card_kind' end);$new$);
 execute s;
 s:=pg_get_functiondef('app.get_sale_receipt_before_usd(uuid)'::regprocedure);
 s:=app.october_replace(s,$old$'method_name',m.name$old$,
 $new$'method_name',case when p.card_kind='CREDIT' then 'Tarjeta de crédito' when p.card_kind='DEBIT' then 'Tarjeta de débito' else m.name end,'card_kind',p.card_kind$new$);
 execute s;
end;
$patch$;
drop function app.october_replace(text,text,text);

create table public.operational_notifications (
 id bigint generated always as identity primary key, location_id uuid not null references public.locations(id),
 permission_code text not null, title text not null, message text not null, href text not null,
 event_key text not null, created_at timestamptz not null default now(), unique(location_id,event_key)
);
create index operational_notifications_location_id_idx on public.operational_notifications(location_id,id);
create table public.operational_notification_reads (
 notification_id bigint not null references public.operational_notifications(id),user_id uuid not null references public.app_users(id),
 read_at timestamptz not null default now(),primary key(notification_id,user_id)
);
alter table public.operational_notification_reads enable row level security;
revoke all on public.operational_notification_reads from public,anon,authenticated,service_role;
alter table public.operational_notifications enable row level security;
revoke all on public.operational_notifications from public,anon,authenticated,service_role;
revoke all on sequence public.operational_notifications_id_seq from public,anon,authenticated,service_role;
create function app.emit_operational_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='transfers' then
  if tg_op='UPDATE' and new.status=old.status then return new; end if;
  insert into public.operational_notifications(location_id,permission_code,title,message,href,event_key)
  select id,'inventory.read','Traspaso #'||new.folio,
   case new.status when 'REQUESTED' then 'Nueva solicitud de traspaso.' when 'IN_TRANSIT' then 'Mercancía enviada; pendiente de recepción.'
    when 'RECEIVED' then 'Recepción confirmada.' when 'CANCELLED' then 'Traspaso cancelado.' else 'Estado actualizado: '||new.status end,
   '/inventario?accion=traspasos','transfer:'||new.id||':'||new.status from public.locations where id in(new.from_location_id,new.to_location_id) on conflict do nothing;
 elsif tg_table_name='inventory_movements' and new.movement_type in ('ADJUSTMENT','COUNT','PURCHASE') then
  insert into public.operational_notifications(location_id,permission_code,title,message,href,event_key)
  values(new.location_id,'inventory.read','Movimiento de inventario','Se registró un movimiento de existencias. Consulta el historial para ver el detalle.','/inventario',new.movement_type||':'||new.reference_type||':'||new.reference_id) on conflict do nothing;
 end if;
 return new;
end;
$$;
create trigger operational_transfer_notice after insert or update on public.transfers for each row execute function app.emit_operational_notification();
create trigger operational_inventory_notice after insert on public.inventory_movements for each row execute function app.emit_operational_notification();
revoke all on function app.emit_operational_notification() from public,anon,authenticated,service_role;
create function public.list_operational_notifications(p_location_id uuid,p_after_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if app.current_user_id() is null or not app.can_access_location(p_location_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from (
  select id,title,message,href,created_at from public.operational_notifications
  where location_id=p_location_id and app.has_perm(permission_code) and not exists (
   select 1 from public.operational_notification_reads r where r.notification_id=operational_notifications.id and r.user_id=app.current_user_id())
  order by id limit 50
 ) n),'[]'::jsonb);
end;
$$;
revoke all on function public.list_operational_notifications(uuid,bigint) from public,anon,service_role;
grant execute on function public.list_operational_notifications(uuid,bigint) to authenticated;
create function public.ack_operational_notifications(p_location_id uuid,p_ids bigint[])
returns void language plpgsql security definer set search_path='' as $$
begin
 if app.current_user_id() is null or not app.can_access_location(p_location_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_ids is null or cardinality(p_ids)>50 then raise exception 'INVALID_NOTIFICATION_IDS' using errcode='22023'; end if;
 insert into public.operational_notification_reads(notification_id,user_id)
 select id,app.current_user_id() from public.operational_notifications where location_id=p_location_id and id=any(p_ids) and app.has_perm(permission_code)
 on conflict do nothing;
end;$$;
revoke all on function public.ack_operational_notifications(uuid,bigint[]) from public,anon,service_role;
grant execute on function public.ack_operational_notifications(uuid,bigint[]) to authenticated;

create function public.report_operational_costs(p_location_id uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_entries jsonb; v_changes jsonb;
begin
 if app.current_user_id() is null or not app.has_perm('reports.inventory') or not app.can_access_location(p_location_id)
 or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=app.current_user_id() and u.is_active and r.code in ('ADMIN','MANAGER')) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>=p_to or p_to-p_from>interval '366 days' then raise exception 'INVALID_REPORT_RANGE' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by occurred_at desc,id desc),'[]'::jsonb) into v_entries from (
  select m.id,m.occurred_at,p.name product_name,v.sku,m.quantity,m.movement_type,m.reference_type,
   case when m.metadata->>'unit_cost_cents' ~ '^[0-9]+$' then (m.metadata->>'unit_cost_cents')::bigint end unit_cost_cents,
   case when m.metadata->>'unit_cost_cents' ~ '^[0-9]+$' then round(m.quantity*(m.metadata->>'unit_cost_cents')::numeric)::bigint end value_cents
  from public.inventory_movements m join public.variants v on v.id=m.variant_id join public.products p on p.id=v.product_id
  where m.location_id=p_location_id and m.occurred_at>=p_from and m.occurred_at<p_to and m.quantity>0
   and (m.movement_type='PURCHASE' or m.reference_type='MANUAL_STOCK_ENTRY')
  order by m.occurred_at desc,m.id desc limit 501
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc),'[]'::jsonb) into v_changes from (
  select a.id,a.occurred_at created_at,a.entity_id,a.location_id,a.before_data->>'cost_cents' previous_cost_cents,a.after_data->>'cost_cents' new_cost_cents
  from public.audit_log a where a.occurred_at>=p_from and a.occurred_at<p_to
   and (a.location_id=p_location_id or a.location_id is null) and a.entity_type='variants'
   and a.before_data ? 'cost_cents' and a.after_data ? 'cost_cents'
   and a.before_data->>'cost_cents' is distinct from a.after_data->>'cost_cents'
  order by a.occurred_at desc limit 501
 ) x;
 return jsonb_build_object('entries',v_entries,'changes',v_changes,'limited',jsonb_array_length(v_entries)>500 or jsonb_array_length(v_changes)>500);
end;
$$;
revoke all on function public.report_operational_costs(uuid,timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.report_operational_costs(uuid,timestamptz,timestamptz) to authenticated;

create table public.location_cash_cuts (
 id uuid primary key, location_id uuid not null references public.locations(id),
 created_by uuid not null references public.app_users(id), created_at timestamptz not null default now(),
 sessions jsonb not null, counted_cents bigint not null, expected_cents bigint not null, difference_cents bigint not null,
 check(difference_cents=counted_cents-expected_cents)
);
create table public.location_cash_cut_sessions (
 session_id uuid primary key references public.cash_sessions(id), cut_id uuid not null references public.location_cash_cuts(id)
);
alter table public.location_cash_cuts enable row level security;
alter table public.location_cash_cut_sessions enable row level security;
revoke all on public.location_cash_cuts,public.location_cash_cut_sessions from public,anon,authenticated,service_role;
create function app.lock_location_cash_cut() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.location_id::text,916));
 return new;
end;$$;
create trigger location_cash_cut_lock before insert or update on public.cash_sessions for each row execute function app.lock_location_cash_cut();
revoke all on function app.lock_location_cash_cut() from public,anon,authenticated,service_role;
create function public.location_cash_cut(p_location_id uuid,p_id uuid default null,p_session_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sessions jsonb; v_ids uuid[]; v_open integer; v_counted bigint; v_expected bigint; v_cut public.location_cash_cuts%rowtype;
begin
 if app.current_user_id() is null or not app.has_perm('cash.close') or not app.can_access_location(p_location_id)
 or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=app.current_user_id() and u.is_active and r.code in ('ADMIN','MANAGER')) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_location_id::text,916));
 if p_id is not null then
  select * into v_cut from public.location_cash_cuts where id=p_id;
  if found then
   if v_cut.location_id<>p_location_id or v_cut.created_by<>app.current_user_id() or
    (select array_agg(session_id order by session_id) from public.location_cash_cut_sessions where cut_id=p_id)
    is distinct from (select array_agg(x order by x) from unnest(p_session_ids) x) then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
   return to_jsonb(v_cut)||jsonb_build_object('saved',true);
  end if;
 end if;
 select count(*) into v_open from public.cash_sessions where location_id=p_location_id and status='OPEN';
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'register_name',r.name,'cashier_name',u.full_name,
  'opened_at',s.opened_at,'closed_at',s.closed_at,'counted_cents',s.counted_amount_cents,
  'expected_cents',s.expected_amount_cents,'difference_cents',s.difference_cents,'reason',s.difference_reason,
  'usd',case when usd.session_id is not null then jsonb_build_object('counted_cents',usd.counted_usd_cents,'expected_cents',usd.expected_usd_cents,'difference_cents',usd.difference_usd_cents) end) order by s.id),'[]'::jsonb),
  array_agg(s.id order by s.id),coalesce(sum(s.counted_amount_cents),0),coalesce(sum(s.expected_amount_cents),0)
 into v_sessions,v_ids,v_counted,v_expected from public.cash_sessions s join public.cash_registers r on r.id=s.register_id
 join public.app_users u on u.id=s.cashier_user_id
 left join public.usd_cash_closes usd on usd.session_id=s.id
 where s.location_id=p_location_id and s.status='CLOSED' and not exists(select 1 from public.location_cash_cut_sessions c where c.session_id=s.id);
 if p_id is null then return jsonb_build_object('sessions',v_sessions,'open_sessions',v_open,'counted_cents',v_counted,'expected_cents',v_expected,'difference_cents',v_counted-v_expected,'saved',false); end if;
 if v_open>0 then raise exception 'LOCATION_HAS_OPEN_SESSIONS' using errcode='22023'; end if;
 if v_ids is null then raise exception 'CUT_EMPTY' using errcode='22023'; end if;
 if v_ids is distinct from (select array_agg(x order by x) from unnest(p_session_ids) x) then raise exception 'CUT_SESSIONS_CHANGED' using errcode='40001'; end if;
 perform set_config('app.october_write','on',true);
 insert into public.location_cash_cuts(id,location_id,created_by,sessions,counted_cents,expected_cents,difference_cents)
 values(p_id,p_location_id,app.current_user_id(),v_sessions,v_counted,v_expected,v_counted-v_expected) returning * into v_cut;
 insert into public.location_cash_cut_sessions select unnest(v_ids),p_id;
 perform set_config('app.october_write','off',true);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,after_data)
 values(app.current_user_id(),'cash.location_cut','location_cash_cuts',p_id::text,p_location_id,to_jsonb(v_cut));
 return to_jsonb(v_cut)||jsonb_build_object('saved',true);
end;$$;
revoke all on function public.location_cash_cut(uuid,uuid,uuid[]) from public,anon,service_role;
grant execute on function public.location_cash_cut(uuid,uuid,uuid[]) to authenticated;

-- A post-sale gift copy may cover the entire ticket. Preselected lines still
-- take precedence in the UI. The sale's immutable commercial snapshot is not edited.
do $gift$
declare s text;
begin
 s:=pg_get_functiondef('public.request_sale_print(uuid,text)'::regprocedure);
 if strpos(s,'where sale_id=p_sale_id and gift_receipt')=0 then raise exception 'GIFT_PRINT_SOURCE_CHANGED'; end if;
 execute replace(s,'where sale_id=p_sale_id and gift_receipt','where sale_id=p_sale_id');
 s:=pg_get_functiondef('public.record_sale_ticket_delivery(uuid,text,text,text)'::regprocedure);
 if strpos(s,'where sale_id = p_sale_id and gift_receipt')=0 then raise exception 'GIFT_DELIVERY_SOURCE_CHANGED'; end if;
 execute replace(s,'where sale_id = p_sale_id and gift_receipt','where sale_id = p_sale_id');
end;
$gift$;
create function public.list_customer_layaway_accounts(p_location_id uuid,p_query text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if app.current_user_id() is null or not app.has_perm('customers.manage') or not app.has_perm('layaways.manage')
  or not app.can_access_location(p_location_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if length(coalesce(p_query,''))>100 then raise exception 'INVALID_QUERY' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by full_name,customer_id) from (
  select c.id customer_id,c.full_name,c.member_number,count(*) active_count,sum(l.paid_cents) paid_cents,
   sum(l.balance_cents) balance_cents,min(l.due_date) due_date
  from public.layaways l join public.customers c on c.id=l.customer_id
  where l.location_id=p_location_id and l.status in ('OPEN','PARTIALLY_PAID','PAID') and not c.is_anonymized
   and (nullif(btrim(p_query),'') is null or lower(c.full_name||' '||c.member_number) like '%'||lower(btrim(p_query))||'%')
  group by c.id,c.full_name,c.member_number order by c.full_name,c.id limit 201
 ) x),'[]'::jsonb);
end;$$;
revoke all on function public.list_customer_layaway_accounts(uuid,text) from public,anon,service_role;
grant execute on function public.list_customer_layaway_accounts(uuid,text) to authenticated;
create function app.guard_october_documents() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'INSERT' or current_setting('app.october_write',true) is distinct from 'on' then
  raise exception 'IMMUTABLE_OPERATIONAL_DOCUMENT' using errcode='42501'; end if;
 return new;
end;$$;
create trigger manual_stock_immutable before insert or update or delete on public.manual_stock_entries for each row execute function app.guard_october_documents();
create trigger location_cut_immutable before insert or update or delete on public.location_cash_cuts for each row execute function app.guard_october_documents();
create trigger location_cut_session_immutable before insert or update or delete on public.location_cash_cut_sessions for each row execute function app.guard_october_documents();
revoke all on function app.guard_october_documents() from public,anon,authenticated,service_role;
create function app.emit_cash_operational_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.movement_type in ('DEPOSIT','WITHDRAWAL') then
  insert into public.operational_notifications(location_id,permission_code,title,message,href,event_key)
  values(new.location_id,'cash.open','Movimiento de caja','Se registró una entrada o retiro. Consulta el historial del turno.','/caja','cash:'||new.id) on conflict do nothing;
 end if;
 return new;
end;$$;
create trigger operational_cash_notice after insert on public.cash_movements for each row execute function app.emit_cash_operational_notification();
revoke all on function app.emit_cash_operational_notification() from public,anon,authenticated,service_role;
commit;
