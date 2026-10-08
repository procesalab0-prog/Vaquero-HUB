begin;
-- Forward-only: no edits to deployed migrations. Catalog prices are never changed.
alter table public.quotes add column customer_name text check(length(customer_name)<=160);
alter table public.quotes add column discount_cents bigint not null default 0 check(discount_cents>=0);
alter table public.quotes drop constraint quotes_check;
alter table public.quotes add constraint quotes_total_cents_check check(total_cents=subtotal_cents-discount_cents and total_cents>0);
alter table public.quote_items add column original_unit_price_cents bigint check(original_unit_price_cents>=0);
alter table public.quote_items add column discount_cents bigint not null default 0 check(discount_cents>=0);
alter table public.quote_items drop constraint quote_items_check;
alter table public.quote_items add constraint quote_items_line_total_cents_check check(line_total_cents=quantity*unit_price_cents-discount_cents and line_total_cents>=0);
alter table public.applied_discounts alter column authorization_id drop not null;
alter table public.applied_discounts add column quote_id uuid references public.quotes(id);
alter table public.applied_discounts add constraint discount_authorization_source check(
  (authorization_id is not null and quote_id is null) or (authorization_id is null and quote_id is not null));
create index applied_discounts_quote_idx on public.applied_discounts(quote_id) where quote_id is not null;

create or replace function app.create_sale_engine(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid default null,
  p_discounts jsonb default '[]'::jsonb,
  p_notes text default null,
  p_quote_id uuid default null
)
returns public.sales
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select app.current_user_id()); v_session public.cash_sessions; v_sale public.sales;
  v_hash text; v_existing public.idempotency_keys; v_item jsonb; v_payment jsonb; v_discount jsonb;
  v_variant public.variants; v_product public.products; v_line integer := 0; v_qty numeric(12,3); v_gross bigint;
  v_item_discount bigint; v_subtotal bigint := 0; v_item_discounts bigint := 0; v_ticket_discount bigint := 0;
  v_after_items bigint; v_paid bigint := 0; v_folio bigint; v_method public.payment_methods;
  v_authorization app.supervisor_authorizations; v_authorization_token uuid; v_has_discount boolean := false;
  v_quote public.quotes; v_quote_item public.quote_items;
  v_sale_item_id uuid; v_discount_type text; v_discount_value numeric; v_amount bigint;
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode='28000'; end if;
  if not (select app.has_perm('pos.sell')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if p_idempotency_key is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100
     or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) not between 1 and 10
     or jsonb_typeof(coalesce(p_discounts,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_discounts,'[]'::jsonb)) > 101
     or length(coalesce(p_notes,'')) > 500 then raise exception 'INVALID_SALE_REQUEST' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) i group by i->>'variant_id' having count(*)>1) then raise exception 'DUPLICATE_VARIANT' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_payments) i group by i->>'method_code' having count(*)>1) then raise exception 'DUPLICATE_PAYMENT_METHOD' using errcode='22023'; end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object('session',p_cash_session_id,'items',p_items,'payments',p_payments,'customer',p_customer_id,'discounts',coalesce(p_discounts,'[]'::jsonb),'notes',p_notes)::text,'UTF8'),'sha256'),'hex');
  if p_quote_id is not null then v_hash:=encode(extensions.digest(convert_to(v_hash||p_quote_id::text,'UTF8'),'sha256'),'hex'); end if;
  perform pg_advisory_xact_lock(hashtextextended('create_sale:'||p_idempotency_key::text,0));
  select * into v_existing from public.idempotency_keys where key=p_idempotency_key;
  if found then
    if v_existing.actor_user_id <> v_actor or v_existing.request_hash <> v_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    if v_existing.resource_id is null then raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode='40001'; end if;
    select * into v_sale from public.sales where id=v_existing.resource_id; return v_sale;
  end if;
  insert into public.idempotency_keys(key,actor_user_id,operation,request_hash) values(p_idempotency_key,v_actor,'CREATE_SALE',v_hash);

  select * into v_session from public.cash_sessions where id=p_cash_session_id and status='OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor or not (select app.can_access_location(v_session.location_id)) then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and not is_anonymized) then raise exception 'CUSTOMER_NOT_FOUND' using errcode='22023'; end if;

  if p_quote_id is not null then
    select * into v_quote from public.quotes where id=p_quote_id for update;
    if not found or not app.has_perm('quotes.manage') or v_quote.location_id<>v_session.location_id
       or v_quote.status not in ('DRAFT','SENT')
       or (v_quote.valid_until is not null and v_quote.valid_until<current_date)
       or v_quote.customer_id is distinct from p_customer_id
       or jsonb_array_length(coalesce(p_discounts,'[]'::jsonb))<>0 then
      raise exception 'INVALID_QUOTE_CONVERSION' using errcode='42501';
    end if;
    if (select count(*) from public.quote_items where quote_id=p_quote_id)<>jsonb_array_length(p_items)
       or exists(select 1 from jsonb_array_elements(p_items) i
          where not exists(select 1 from public.quote_items qi where qi.quote_id=p_quote_id
            and qi.variant_id=(i->>'variant_id')::uuid and qi.quantity=(i->>'quantity')::numeric)) then
      raise exception 'QUOTE_ITEMS_CHANGED' using errcode='22023';
    end if;
  end if;

  v_has_discount := jsonb_array_length(coalesce(p_discounts,'[]'::jsonb)) > 0;
  if v_has_discount then
    begin v_authorization_token := (p_discounts->0->>'authorization_token')::uuid; exception when others then raise exception 'DISCOUNT_AUTHORIZATION_REQUIRED' using errcode='42501'; end;
    select * into v_authorization from app.supervisor_authorizations
    where id=v_authorization_token and actor_user_id=v_actor and permission_code='sales.discount' and used_at is null and expires_at>now() for update;
    if not found then raise exception 'DISCOUNT_AUTHORIZATION_INVALID' using errcode='42501'; end if;
  end if;

  -- Orden estable para que dos cajas que venden las mismas variantes no entren en deadlock.
  perform pg_advisory_xact_lock(hashtextextended('sale-stock:'||(i->>'variant_id'),0))
  from jsonb_array_elements(p_items) i order by i->>'variant_id';

  insert into public.folios(location_id,document_type,next_number) values(v_session.location_id,'SALE',2)
  on conflict(location_id,document_type) do update set next_number=public.folios.next_number+1
  returning next_number-1 into v_folio;

  perform set_config('app.sales_write','on',true);
  insert into public.sales(location_id,cash_session_id,cashier_user_id,customer_id,folio_number,folio,subtotal_cents,item_discount_cents,ticket_discount_cents,total_cents,notes)
  values(v_session.location_id,v_session.id,v_actor,p_customer_id,v_folio,
    (select code from public.locations where id=v_session.location_id)||'-V-'||lpad(v_folio::text,6,'0'),0,0,0,0,nullif(btrim(coalesce(p_notes,'')),'')) returning * into v_sale;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line+1;
    begin v_qty := (v_item->>'quantity')::numeric; exception when others then raise exception 'INVALID_ITEM' using errcode='22023'; end;
    if v_qty is null or v_qty<=0 or v_qty>999999999.999 then raise exception 'INVALID_ITEM' using errcode='22023'; end if;
    select v.* into v_variant from public.variants v join public.products p on p.id=v.product_id
    where v.id=(v_item->>'variant_id')::uuid and v.is_active and p.is_active for update of v;
    if not found then raise exception 'VARIANT_NOT_SELLABLE' using errcode='22023'; end if;
    select * into v_product from public.products where id=v_variant.product_id;
    v_item_discount:=0;
    if p_quote_id is not null then
      select * into strict v_quote_item from public.quote_items where quote_id=p_quote_id and variant_id=v_variant.id;
      v_variant.price_cents:=v_quote_item.unit_price_cents;
      v_item_discount:=v_quote_item.discount_cents;
    end if;
    v_gross := round(v_qty*v_variant.price_cents)::bigint;
    select d into v_discount from jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
    where d->>'scope'='ITEM' and (d->>'line_number')::integer=v_line limit 1;
    if found then
      v_discount_type:=v_discount->>'type'; begin v_discount_value:=(v_discount->>'value')::numeric; exception when others then raise exception 'INVALID_DISCOUNT' using errcode='22023'; end;
      if v_discount_type='AMOUNT' then v_item_discount:=round(v_discount_value)::bigint;
      elsif v_discount_type='PERCENT' and v_discount_value>0 and v_discount_value<=100 then v_item_discount:=round(v_gross*v_discount_value/100)::bigint;
      else raise exception 'INVALID_DISCOUNT' using errcode='22023'; end if;
      if v_item_discount<=0 or v_item_discount>v_gross then raise exception 'INVALID_DISCOUNT' using errcode='22023'; end if;
    end if;
    insert into public.sale_items(sale_id,line_number,variant_id,product_name,sku,variant_description,quantity,unit_price_cents,unit_cost_cents,gross_cents,item_discount_cents,line_total_cents,gift_receipt)
    values(v_sale.id,v_line,v_variant.id,v_product.name,v_variant.sku,'',v_qty,v_variant.price_cents,v_variant.cost_cents,v_gross,v_item_discount,v_gross-v_item_discount,coalesce((v_item->>'gift_receipt')::boolean,false)) returning id into v_sale_item_id;
    if v_item_discount>0 then
      if p_quote_id is not null then
        insert into public.applied_discounts(sale_id,sale_item_id,scope,discount_type,requested_value,amount_cents,authorized_by,quote_id,reason)
        values(v_sale.id,v_sale_item_id,'ITEM','AMOUNT',v_item_discount,v_item_discount,v_quote.created_by,v_quote.id,'Cotización '||v_quote.folio);
      else
      insert into public.applied_discounts(sale_id,sale_item_id,scope,discount_type,requested_value,amount_cents,authorized_by,authorization_id,reason)
      values(v_sale.id,v_sale_item_id,'ITEM',v_discount_type,v_discount_value,v_item_discount,v_authorization.supervisor_user_id,v_authorization.id,v_discount->>'reason');
      end if;
    end if;
    v_subtotal:=v_subtotal+v_gross; v_item_discounts:=v_item_discounts+v_item_discount;
  end loop;

  v_after_items:=v_subtotal-v_item_discounts;
  if (select count(*) from jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d where d->>'scope'='TICKET') > 1 then raise exception 'MULTIPLE_TICKET_DISCOUNTS_NOT_SUPPORTED' using errcode='22023'; end if;
  select d into v_discount from jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d where d->>'scope'='TICKET' limit 1;
  if found then
    v_discount_type:=v_discount->>'type'; begin v_discount_value:=(v_discount->>'value')::numeric; exception when others then raise exception 'INVALID_DISCOUNT' using errcode='22023'; end;
    if v_discount_type='AMOUNT' then v_ticket_discount:=round(v_discount_value)::bigint;
    elsif v_discount_type='PERCENT' and v_discount_value>0 and v_discount_value<=100 then v_ticket_discount:=round(v_after_items*v_discount_value/100)::bigint;
    else raise exception 'INVALID_DISCOUNT' using errcode='22023'; end if;
    if v_ticket_discount<=0 or v_ticket_discount>v_after_items then raise exception 'INVALID_DISCOUNT' using errcode='22023'; end if;
    insert into public.applied_discounts(sale_id,scope,discount_type,requested_value,amount_cents,authorized_by,authorization_id,reason)
    values(v_sale.id,'TICKET',v_discount_type,v_discount_value,v_ticket_discount,v_authorization.supervisor_user_id,v_authorization.id,v_discount->>'reason');
    -- Largest remainder: reparte cada centavo exactamente y de forma determinista.
    with shares as (
      select id,line_number,line_total_cents,
        floor(line_total_cents::numeric*v_ticket_discount/nullif(v_after_items,0))::bigint base,
        (line_total_cents::numeric*v_ticket_discount/nullif(v_after_items,0))-floor(line_total_cents::numeric*v_ticket_discount/nullif(v_after_items,0)) fraction
      from public.sale_items where sale_id=v_sale.id
    ), ranked as (
      select *,row_number() over(order by fraction desc,line_number) rn,
        v_ticket_discount-sum(base) over() remaining from shares
    )
    update public.sale_items si set ticket_discount_cents=r.base+case when r.rn<=r.remaining then 1 else 0 end
    from ranked r where si.id=r.id;
  end if;
  if v_after_items-v_ticket_discount<=0 then raise exception 'SALE_TOTAL_MUST_BE_POSITIVE' using errcode='22023'; end if;

  update public.sales set subtotal_cents=v_subtotal,item_discount_cents=v_item_discounts,ticket_discount_cents=v_ticket_discount,total_cents=v_after_items-v_ticket_discount where id=v_sale.id returning * into v_sale;

  for v_payment in select value from jsonb_array_elements(p_payments) loop
    begin v_amount:=(v_payment->>'amount_cents')::bigint; exception when others then raise exception 'INVALID_PAYMENT' using errcode='22023'; end;
    select * into v_method from public.payment_methods where code=upper(v_payment->>'method_code') and is_active;
    if not found or v_amount is null or v_amount<=0 then raise exception 'INVALID_PAYMENT' using errcode='22023'; end if;
    if v_method.requires_reference and length(btrim(coalesce(v_payment->>'reference',''))) < 3 then raise exception 'PAYMENT_REFERENCE_REQUIRED' using errcode='22023'; end if;
    if v_method.kind='CASH' then
      if coalesce((v_payment->>'tendered_cents')::bigint,-1)<v_amount then raise exception 'INSUFFICIENT_CASH_TENDERED' using errcode='22023'; end if;
      insert into public.sale_payments(sale_id,method_code,amount_cents,tendered_cents,change_cents,reference)
      values(v_sale.id,v_method.code,v_amount,(v_payment->>'tendered_cents')::bigint,(v_payment->>'tendered_cents')::bigint-v_amount,null);
    else
      insert into public.sale_payments(sale_id,method_code,amount_cents,reference) values(v_sale.id,v_method.code,v_amount,btrim(v_payment->>'reference'));
    end if;
    v_paid:=v_paid+v_amount;
  end loop;
  if v_paid<>v_sale.total_cents then raise exception 'PAYMENT_TOTAL_MISMATCH' using errcode='23514'; end if;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'variant_id' loop
    perform app.apply_movement((v_item->>'variant_id')::uuid,v_session.location_id,'SALE',-((v_item->>'quantity')::numeric),'SALE',v_sale.id::text,jsonb_build_object('folio',v_sale.folio));
  end loop;

  perform set_config('app.cash_write','on',true);
  insert into public.cash_movements(session_id,location_id,movement_type,amount_cents,reference_type,reference_id,user_id,metadata)
  select v_session.id,v_session.location_id,'SALE',sum(p.amount_cents),'SALE',v_sale.id::text,v_actor,jsonb_build_object('folio',v_sale.folio)
  from public.sale_payments p join public.payment_methods m on m.code=p.method_code where p.sale_id=v_sale.id and m.kind='CASH' having sum(p.amount_cents)>0;
  perform set_config('app.cash_write','off',true);
  if v_has_discount then update app.supervisor_authorizations set used_at=now(),resource_id=v_sale.id where id=v_authorization.id; end if;
  update public.idempotency_keys set resource_id=v_sale.id where key=p_idempotency_key;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,after_data,metadata)
  values(v_actor,'sale.created','sales',v_sale.id::text,v_session.location_id,to_jsonb(v_sale),jsonb_build_object('item_count',jsonb_array_length(p_items),'payment_count',jsonb_array_length(p_payments)));
  perform set_config('app.sales_write','off',true);
  return v_sale;
end;
$$;



-- Public API keeps the same signature; untrusted callers cannot pass a quote ID.
create or replace function public.create_sale(
 p_idempotency_key uuid,p_cash_session_id uuid,p_items jsonb,p_payments jsonb,
 p_customer_id uuid default null,p_discounts jsonb default '[]'::jsonb,p_notes text default null
) returns public.sales language sql security definer set search_path='' as $$
 select app.create_sale_engine(p_idempotency_key,p_cash_session_id,p_items,p_payments,p_customer_id,p_discounts,p_notes,null);
$$;
revoke all on function app.create_sale_engine(uuid,uuid,jsonb,jsonb,uuid,jsonb,text,uuid) from public,anon,authenticated,service_role;


-- Existing quotes keep their original API; custom prices require live ADMIN.
create or replace function public.create_quote_v2(
 p_location_id uuid,p_items jsonb,p_customer_id uuid default null,
 p_valid_until date default null,p_notes text default null,p_customer_name text default null
) returns public.quotes language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app.current_user_id(); v_admin boolean; v_quote public.quotes;
 v_item jsonb; v_line public.quote_items; v_price bigint; v_discount bigint;
 v_subtotal bigint:=0; v_discounts bigint:=0; v_name text:=nullif(btrim(p_customer_name),'');
begin
 if v_actor is null or not app.has_perm('quotes.manage') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 select exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=v_actor and u.is_active and r.code='ADMIN') into v_admin;
 if length(v_name)>160 or (v_name is not null and p_customer_id is not null) then raise exception 'INVALID_QUOTE_CUSTOMER' using errcode='22023'; end if;
 perform app.assert_quote_items(p_items);
 if not v_admin and exists(select 1 from jsonb_array_elements(p_items) i where i ? 'unit_price_cents' or i ? 'discount_cents') then
  raise exception 'QUOTE_CUSTOM_PRICE_ADMIN_ONLY' using errcode='42501';
 end if;
 v_quote:=public.create_quote(p_location_id,p_items,p_customer_id,p_valid_until,p_notes);
 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into strict v_line from public.quote_items where quote_id=v_quote.id and variant_id=(v_item->>'variant_id')::uuid;
  if (v_item ? 'unit_price_cents' and coalesce(v_item->>'unit_price_cents','') !~ '^[0-9]{1,12}$')
    or (v_item ? 'discount_cents' and coalesce(v_item->>'discount_cents','') !~ '^[0-9]{1,15}$') then
   raise exception 'INVALID_QUOTE_PRICING' using errcode='22023';
  end if;
  v_price:=coalesce((v_item->>'unit_price_cents')::bigint,v_line.unit_price_cents);
  v_discount:=coalesce((v_item->>'discount_cents')::bigint,0);
  if v_discount>v_price*v_line.quantity then raise exception 'INVALID_QUOTE_PRICING' using errcode='22023'; end if;
  update public.quote_items set original_unit_price_cents=v_line.unit_price_cents,unit_price_cents=v_price,
   discount_cents=v_discount,line_total_cents=v_price*quantity-v_discount where id=v_line.id;
  v_subtotal:=v_subtotal+v_price*v_line.quantity; v_discounts:=v_discounts+v_discount;
 end loop;
 if v_subtotal>9007199254740991 or v_subtotal-v_discounts<=0 then raise exception 'INVALID_QUOTE_PRICING' using errcode='22023'; end if;
 update public.quotes set customer_name=v_name,subtotal_cents=v_subtotal,discount_cents=v_discounts,total_cents=v_subtotal-v_discounts
 where id=v_quote.id returning * into v_quote;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,after_data,metadata)
 values(v_actor,'quote.pricing_approved','quotes',v_quote.id::text,p_location_id,to_jsonb(v_quote),
  jsonb_build_object('items',(select jsonb_agg(to_jsonb(i) order by line_number) from public.quote_items i where quote_id=v_quote.id)));
 return v_quote;
end;
$$;
create or replace function public.list_quotes(
  p_location_id uuid,
  p_status text default null,
  p_query text default '',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('quotes.manage'))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('DRAFT', 'SENT', 'CONVERTED', 'EXPIRED') then
    raise exception 'INVALID_QUOTE_STATUS' using errcode = '22023';
  end if;
  update public.quotes set status = 'EXPIRED', updated_at = now()
  where location_id = p_location_id and status in ('DRAFT', 'SENT')
    and valid_until is not null and valid_until < current_date;

  select coalesce(jsonb_agg(row_data order by (row_data->>'created_at') desc), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', q.id, 'folio', q.folio, 'status', q.status,
      'customer_name', q.customer_name, 'discount_cents', q.discount_cents,
      'subtotal_cents', q.subtotal_cents, 'total_cents', q.total_cents,
      'valid_until', q.valid_until, 'notes', q.notes, 'sent_at', q.sent_at,
      'converted_at', q.converted_at, 'converted_sale_id', q.converted_sale_id,
      'created_at', q.created_at, 'created_by_name', u.full_name,
      'customer', case when c.id is null then null else jsonb_build_object(
        'id', c.id, 'member_number', c.member_number, 'full_name', c.full_name,
        'phone_e164', c.phone_e164, 'email', c.email
      ) end,
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'variant_id', i.variant_id, 'product_name', i.product_name, 'sku', i.sku,
        'variant_description', i.variant_description, 'quantity', i.quantity,
        'original_unit_price_cents',coalesce(i.original_unit_price_cents,i.unit_price_cents),'discount_cents',i.discount_cents,
        'unit_price_cents', i.unit_price_cents, 'line_total_cents', i.line_total_cents
      ) order by i.line_number), '[]'::jsonb) from public.quote_items i where i.quote_id = q.id)
    ) row_data
    from public.quotes q
    join public.app_users u on u.id = q.created_by
    left join public.customers c on c.id = q.customer_id and not c.is_anonymized
    where q.location_id = p_location_id
      and (p_status is null or q.status = p_status)
      and (coalesce(btrim(p_query), '') = '' or q.folio ilike '%' || btrim(p_query) || '%'
        or q.customer_name ilike '%' || btrim(p_query) || '%'
        or c.full_name ilike '%' || btrim(p_query) || '%'
        or exists (select 1 from public.quote_items qi where qi.quote_id = q.id
          and (qi.product_name ilike '%' || btrim(p_query) || '%' or qi.sku ilike '%' || btrim(p_query) || '%')))
    order by q.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  ) rows;
  return v_result;
end;
$$;

create or replace function public.convert_quote_to_sale(
  p_quote_id uuid,
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_payments jsonb
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_quote public.quotes;
  v_session public.cash_sessions;
  v_sale public.sales;
  v_items jsonb;
begin
  if v_actor is null or not (select app.has_perm('quotes.manage')) or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or not (select app.can_access_location(v_quote.location_id)) then
    raise exception 'QUOTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_quote.status = 'CONVERTED' and v_quote.converted_sale_id is not null then
    select * into v_sale from public.sales where id = v_quote.converted_sale_id;
    return v_sale;
  end if;
  if v_quote.valid_until is not null and v_quote.valid_until < current_date then
    update public.quotes set status = 'EXPIRED', updated_at = now() where id = v_quote.id;
    raise exception 'QUOTE_EXPIRED' using errcode = '22023';
  end if;
  if v_quote.status not in ('DRAFT', 'SENT') then
    raise exception 'QUOTE_NOT_CONVERTIBLE' using errcode = '22023';
  end if;
  v_session := app.assert_owned_open_cash_session(p_cash_session_id, v_actor);
  if v_session.location_id <> v_quote.location_id then
    raise exception 'QUOTE_LOCATION_MISMATCH' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.quote_items i join public.variants v on v.id = i.variant_id
    join public.products p on p.id = v.product_id
    where i.quote_id = v_quote.id and (not v.is_active or not p.is_active )
  ) then
    raise exception 'QUOTE_PRICE_OR_PRODUCT_CHANGED' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'quantity', i.quantity, 'gift_receipt', false) order by i.line_number)
  into v_items from public.quote_items i where i.quote_id = v_quote.id;
  v_sale := app.create_sale_engine(
    p_idempotency_key, p_cash_session_id, v_items, p_payments,
    v_quote.customer_id, '[]'::jsonb, 'Cotización ' || v_quote.folio || coalesce(' · Cliente: '||v_quote.customer_name,''),v_quote.id
  );
  update public.quotes set status = 'CONVERTED', converted_at = now(),
    converted_sale_id = v_sale.id, updated_at = now()
  where id = v_quote.id returning * into v_quote;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, metadata)
  values (v_actor, 'quote.converted', 'quotes', v_quote.id::text, v_quote.location_id,
    jsonb_build_object('sale_id', v_sale.id, 'sale_folio', v_sale.folio));
  return v_sale;
end;
$$;

create or replace function public.list_my_pos_drafts(p_cash_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_session public.cash_sessions; v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_session := app.assert_owned_open_cash_session(p_cash_session_id,v_actor);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'status',d.status,'label',d.label,'items',d.items,'discount_percent',d.discount_percent,
    'quote_id',d.quote_id,'quote_pricing',case when q.id is null then null else jsonb_build_object(
      'subtotal_cents',q.subtotal_cents,'discount_cents',q.discount_cents,'total_cents',q.total_cents,'customer_name',q.customer_name,
      'items',(select jsonb_agg(jsonb_build_object('variant_id',i.variant_id,'unit_price_cents',i.unit_price_cents,'discount_cents',i.discount_cents,'line_total_cents',i.line_total_cents) order by i.line_number) from public.quote_items i where i.quote_id=q.id)
    ) end,'held_at',d.held_at,'updated_at',d.updated_at,
    'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'member_number',c.member_number,'full_name',c.full_name,'phone_e164',c.phone_e164,'email',c.email) end
  ) order by case when d.status='CURRENT' then 0 else 1 end,d.updated_at desc),'[]'::jsonb) into v_result
  from public.pos_drafts d left join public.quotes q on q.id=d.quote_id left join public.customers c on c.id=d.customer_id and not c.is_anonymized
  where d.cash_session_id=v_session.id and d.cashier_user_id=v_actor;
  return v_result;
end;
$$;


create or replace function public.authorize_quote_validity(p_quote_id uuid,p_valid_until date,p_reason text)
returns public.quotes language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app.current_user_id(); v_quote public.quotes; v_before jsonb;
begin
 if v_actor is null or not app.has_perm('quotes.manage') or not exists(
  select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=v_actor and u.is_active and r.code='ADMIN'
 ) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_valid_until is null or p_valid_until<current_date or nullif(btrim(p_reason),'') is null or length(p_reason)>300 then
  raise exception 'INVALID_QUOTE_EXCEPTION' using errcode='22023'; end if;
 select * into v_quote from public.quotes where id=p_quote_id for update;
 if not found or not app.can_access_location(v_quote.location_id) then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 if v_quote.status='CONVERTED' then raise exception 'QUOTE_NOT_CONVERTIBLE' using errcode='22023'; end if;
 v_before:=to_jsonb(v_quote);
 update public.quotes set valid_until=p_valid_until,status=case when sent_at is null then 'DRAFT' else 'SENT' end,updated_at=now()
 where id=v_quote.id returning * into v_quote;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,before_data,after_data,metadata)
 values(v_actor,'quote.validity_authorized','quotes',v_quote.id::text,v_quote.location_id,v_before,to_jsonb(v_quote),jsonb_build_object('reason',btrim(p_reason)));
 return v_quote;
end;
$$;
-- A linked POS draft is a view of the approved quote, not a second editable quote.
create or replace function app.guard_quote_draft_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.quote_id is not null and (
  new.quote_id is distinct from old.quote_id or new.items is distinct from old.items
  or new.customer_id is distinct from old.customer_id or new.discount_percent<>0
 ) then raise exception 'QUOTE_DRAFT_LOCKED' using errcode='42501'; end if;
 return new;
end;
$$;
revoke all on function app.guard_quote_draft_snapshot() from public,anon,authenticated,service_role;
create trigger quote_draft_snapshot before update on public.pos_drafts for each row execute function app.guard_quote_draft_snapshot();

-- Pricing cannot be edited directly by browser or service-role clients.
revoke insert,update,delete on public.quotes,public.quote_items from service_role;
revoke all on function public.create_quote_v2(uuid,jsonb,uuid,date,text,text),public.authorize_quote_validity(uuid,date,text) from public,anon;
grant execute on function public.create_quote_v2(uuid,jsonb,uuid,date,text,text),public.authorize_quote_validity(uuid,date,text) to authenticated,service_role;
commit;
