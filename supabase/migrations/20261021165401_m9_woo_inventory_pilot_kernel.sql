begin;
-- Maintenance-only, test-origin-pinned kernel. No public RPC or transport.
create table app.m9_woo_pilot_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 origin text not null check(origin='https://salmon-nightingale-251188.hostingersite.com'),
 actor_id uuid references public.app_users(id),
 location_id uuid references public.locations(id),
 expires_at timestamptz,
 check(not enabled or (actor_id is not null and location_id is not null and expires_at is not null))
);
insert into app.m9_woo_pilot_control(singleton,origin) values(true,'https://salmon-nightingale-251188.hostingersite.com');

create table app.m9_woo_pilot_links (
 origin text not null check(origin='https://salmon-nightingale-251188.hostingersite.com'),
 woo_product_id bigint not null check(woo_product_id>0),
 woo_variation_id bigint not null check(woo_variation_id>=0),
 variant_id uuid not null references public.variants(id),
 barcode text not null check(barcode<>'' and barcode=btrim(barcode)),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 primary key(origin,woo_product_id,woo_variation_id), unique(origin,variant_id), unique(origin,barcode)
);
create table app.m9_woo_pilot_orders (
 origin text not null, order_id bigint not null check(order_id>0),
 location_id uuid not null references public.locations(id),
 version bigint not null default 0 check(version>=0),
 primary key(origin,order_id)
);
create table app.m9_woo_pilot_lines (
 origin text not null, order_id bigint not null, line_id bigint not null check(line_id>0),
 woo_product_id bigint not null, woo_variation_id bigint not null,
 variant_id uuid not null references public.variants(id), barcode text not null,
 ordered_qty bigint not null check(ordered_qty>0),
 reserved_qty bigint not null check(reserved_qty>=0),
 consumed_qty bigint not null default 0 check(consumed_qty>=0),
 released_qty bigint not null default 0 check(released_qty>=0),
 restocked_qty bigint not null default 0 check(restocked_qty>=0),
 primary key(origin,order_id,line_id), unique(origin,order_id,variant_id),
 foreign key(origin,order_id) references app.m9_woo_pilot_orders(origin,order_id),
 check(ordered_qty=reserved_qty+consumed_qty+released_qty), check(restocked_qty<=consumed_qty)
);
create table app.m9_woo_pilot_receipts (
 id uuid primary key default gen_random_uuid(), origin text not null,
 order_id bigint not null, operation_id text not null, actor_id uuid not null references public.app_users(id),
 request_sha256 text not null, packet jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(origin,order_id,operation_id),
 foreign key(origin,order_id) references app.m9_woo_pilot_orders(origin,order_id)
);
create table app.m9_woo_pilot_stock_outbox (
 origin text not null, variant_id uuid not null references public.variants(id),
 location_id uuid not null references public.locations(id),
 revision bigint not null check(revision>0), available_qty numeric not null check(available_qty>=0),
 last_receipt_id uuid not null references app.m9_woo_pilot_receipts(id),
 primary key(origin,variant_id,location_id)
);

-- No browser, service key or public API can activate or call the pilot.
do $$
declare t text;
begin
 foreach t in array array['m9_woo_pilot_control','m9_woo_pilot_links','m9_woo_pilot_orders',
  'm9_woo_pilot_lines','m9_woo_pilot_receipts','m9_woo_pilot_stock_outbox'] loop
  execute format('alter table app.%I enable row level security',t);
  execute format('revoke all on app.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function app.m9_woo_pilot_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'WOO_PILOT_RECEIPT_IMMUTABLE'; end $$;
revoke all on function app.m9_woo_pilot_immutable() from public,anon,authenticated,service_role;
create trigger m9_woo_receipt_immutable before update or delete on app.m9_woo_pilot_receipts
for each row execute function app.m9_woo_pilot_immutable();

create function app.m9_woo_pilot_command(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 c app.m9_woo_pilot_control; o app.m9_woo_pilot_orders;
 prior app.m9_woo_pilot_receipts; l app.m9_woo_pilot_lines;
 link app.m9_woo_pilot_links; line jsonb; rid uuid:=gen_random_uuid();
 oid bigint; op text; action text; actor uuid; h text; q bigint;
 previous_reserved numeric; new_reserved numeric; result jsonb;
 old_inventory text:=current_setting('app.inventory_write',true);
 old_layaway text:=current_setting('app.layaway_write',true);
begin
 if current_user<>'postgres' then raise exception 'WOO_PILOT_OPERATOR_ONLY' using errcode='42501'; end if;
 perform app.assert_sicar_staging_enabled();
 lock table app.m9_woo_pilot_links,app.m9_rehearsal_control,app.m9_rehearsal_allowlist,
  public.variants,public.products,public.barcodes in share mode;
 actor:=app.current_user_id();
 select * into strict c from app.m9_woo_pilot_control where singleton for share;
 if not c.enabled or c.expires_at<=clock_timestamp() or c.expires_at>clock_timestamp()+interval '15 minutes'
  or actor is distinct from c.actor_id or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id
    where u.id=actor and u.is_active and r.code='ADMIN') or not app.can_access_location(c.location_id)
  or not exists(select 1 from public.locations where id=c.location_id and is_active and type='STORE')
 then raise exception 'WOO_PILOT_DISABLED' using errcode='42501'; end if;
 if jsonb_typeof(p) is distinct from 'object' or pg_column_size(p)>65536 or
  (select array_agg(k order by k) from jsonb_object_keys(p) k) is distinct from
  array['action','evidence_sha256','expected_version','lines','operation_id','order_id','reason','store_origin']::text[]
  or p->>'store_origin' is distinct from c.origin or jsonb_typeof(p->'order_id') is distinct from 'number'
  or coalesce(p->>'order_id','') !~ '^[1-9][0-9]{0,15}$' or (p->>'order_id')::numeric>9007199254740991
  or jsonb_typeof(p->'expected_version') is distinct from 'number' or coalesce(p->>'expected_version','') !~ '^[0-9]{1,15}$'
  or jsonb_typeof(p->'operation_id') is distinct from 'string' or coalesce(p->>'operation_id','') !~ '^[A-Za-z0-9:_-]{1,120}$'
  or jsonb_typeof(p->'evidence_sha256') is distinct from 'string' or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p->'reason') is distinct from 'string' or nullif(btrim(p->>'reason'),'') is null or length(p->>'reason')>500
  or coalesce(p->>'action','') not in ('RESERVE','CONSUME','RELEASE','RESTOCK')
  or jsonb_typeof(p->'lines') is distinct from 'array' then raise exception 'WOO_COMMAND_INVALID'; end if;
 if jsonb_array_length(p->'lines') not between 1 and 50 then raise exception 'WOO_LINES_INVALID'; end if;
 oid:=(p->>'order_id')::bigint; op:=p->>'operation_id'; action:=p->>'action';
 h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 -- Serialize order creation, retries and transitions; inventory rows use the POS row lock.
 perform pg_advisory_xact_lock(hashtextextended(c.origin||'/'||oid,0));
 select * into prior from app.m9_woo_pilot_receipts where origin=c.origin and order_id=oid and operation_id=op;
 if found then
  if prior.request_sha256 is distinct from h or prior.actor_id is distinct from actor then raise exception 'WOO_OPERATION_REUSED'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into o from app.m9_woo_pilot_orders where origin=c.origin and order_id=oid for update;
 if found then
  if action='RESERVE' then raise exception 'WOO_ORDER_ALREADY_RESERVED'; end if;
  if o.location_id<>c.location_id or o.version<>(p->>'expected_version')::bigint then raise exception 'WOO_ORDER_VERSION_CONFLICT'; end if;
 else
  if action<>'RESERVE' or (p->>'expected_version')::bigint<>0 then raise exception 'WOO_ORDER_NOT_RESERVED'; end if;
  insert into app.m9_woo_pilot_orders(origin,order_id,location_id) values(c.origin,oid,c.location_id) returning * into o;
 end if;
 -- Validate ALL identities before effects; lock rows in stable order across orders.
 for line in select value from jsonb_array_elements(p->'lines') loop
  if jsonb_typeof(line) is distinct from 'object' or
   (select array_agg(k order by k) from jsonb_object_keys(line) k) is distinct from
   array['barcode','line_id','product_id','quantity','variation_id']::text[]
   or jsonb_typeof(line->'line_id') is distinct from 'number' or coalesce(line->>'line_id','') !~ '^[1-9][0-9]{0,15}$'
   or (line->>'line_id')::numeric>9007199254740991
   or jsonb_typeof(line->'product_id') is distinct from 'number' or coalesce(line->>'product_id','') !~ '^[1-9][0-9]{0,15}$'
   or (line->>'product_id')::numeric>9007199254740991
   or jsonb_typeof(line->'variation_id') is distinct from 'number' or coalesce(line->>'variation_id','') !~ '^[0-9]{1,16}$'
   or (line->>'variation_id')::numeric>9007199254740991
   or jsonb_typeof(line->'quantity') is distinct from 'number' or coalesce(line->>'quantity','') !~ '^[1-9][0-9]{0,8}$'
   or jsonb_typeof(line->'barcode') is distinct from 'string' or nullif(line->>'barcode','') is null
   or line->>'barcode'<>btrim(line->>'barcode') or length(line->>'barcode')>160 then raise exception 'WOO_LINE_INVALID'; end if;
  select * into link from app.m9_woo_pilot_links where origin=c.origin
   and woo_product_id=(line->>'product_id')::bigint and woo_variation_id=(line->>'variation_id')::bigint;
  if not found or link.barcode is distinct from line->>'barcode' or not exists(select 1 from public.barcodes b
    join public.variants v on v.id=b.variant_id join public.products pr on pr.id=v.product_id
    where b.variant_id=link.variant_id and b.code=link.barcode and b.source='SICAR'
    and pr.measure_unit_code='PIECE') then raise exception 'WOO_IDENTITY_UNCONFIRMED'; end if;
  if action in ('RESERVE','CONSUME') and (app.m9_rehearsal_status(link.variant_id) is not null
   or not exists(select 1 from public.variants v join public.products pr on pr.id=v.product_id
      where v.id=link.variant_id and v.is_active and pr.is_active)) then raise exception 'WOO_VARIANT_BLOCKED'; end if;
 end loop;
 if (select count(distinct value->>'line_id') from jsonb_array_elements(p->'lines'))<>jsonb_array_length(p->'lines')
 or (select count(distinct (value->>'product_id',value->>'variation_id')) from jsonb_array_elements(p->'lines'))<>jsonb_array_length(p->'lines')
 then raise exception 'WOO_DUPLICATE_LINE'; end if;
 perform 1 from public.inventory_by_location i join app.m9_woo_pilot_links m on m.variant_id=i.variant_id and m.origin=c.origin
 join jsonb_array_elements(p->'lines') x on m.woo_product_id=(x->>'product_id')::bigint and m.woo_variation_id=(x->>'variation_id')::bigint
 where i.location_id=c.location_id order by i.variant_id for update of i;
 for line in select x.value from jsonb_array_elements(p->'lines') x join app.m9_woo_pilot_links m
  on m.origin=c.origin and m.woo_product_id=(x.value->>'product_id')::bigint
  and m.woo_variation_id=(x.value->>'variation_id')::bigint order by m.variant_id loop
  select * into strict link from app.m9_woo_pilot_links where origin=c.origin
   and woo_product_id=(line->>'product_id')::bigint and woo_variation_id=(line->>'variation_id')::bigint;
  q:=(line->>'quantity')::bigint;
  if action='RESERVE' then
   insert into app.m9_woo_pilot_lines(origin,order_id,line_id,woo_product_id,woo_variation_id,variant_id,barcode,ordered_qty,reserved_qty)
   values(c.origin,oid,(line->>'line_id')::bigint,link.woo_product_id,link.woo_variation_id,link.variant_id,link.barcode,q,q);
  else
   select * into l from app.m9_woo_pilot_lines where origin=c.origin and order_id=oid and line_id=(line->>'line_id')::bigint;
   if not found or l.variant_id is distinct from link.variant_id or l.woo_product_id<>link.woo_product_id
    or l.woo_variation_id<>link.woo_variation_id or l.barcode<>link.barcode then raise exception 'WOO_ORDER_LINE_CHANGED'; end if;
   if (action in ('CONSUME','RELEASE') and q>l.reserved_qty) or (action='RESTOCK' and q>l.consumed_qty-l.restocked_qty)
    then raise exception 'WOO_LINE_QUANTITY_EXCEEDED'; end if;
  end if;
  if action in ('RESERVE','CONSUME','RELEASE') then
   perform set_config('app.inventory_write','on',true);
   update public.inventory_by_location set reserved_qty=reserved_qty+(case when action='RESERVE' then q else -q end),updated_at=now()
   where variant_id=link.variant_id and location_id=c.location_id
    and (case when action='RESERVE' then qty-reserved_qty>=q else reserved_qty>=q end)
   returning reserved_qty-(case when action='RESERVE' then q else -q end),reserved_qty into previous_reserved,new_reserved;
   if not found then raise exception 'INSUFFICIENT_STOCK'; end if;
   perform set_config('app.inventory_write',coalesce(old_inventory,'off'),true);
   perform set_config('app.layaway_write','on',true);
   insert into public.inventory_reservation_movements(variant_id,location_id,movement_type,quantity,previous_reserved_qty,new_reserved_qty,
    reference_type,reference_id,operation_key,user_id,metadata)
   values(link.variant_id,c.location_id,case action when 'RESERVE' then 'RESERVE' when 'CONSUME' then 'FULFILL' else 'RELEASE' end,
    case when action='RESERVE' then q else -q end,previous_reserved,new_reserved,'M9_WOO_PILOT',rid::text,rid,actor,
    jsonb_build_object('order_id',oid,'line_id',(line->>'line_id')::bigint,'evidence_sha256',p->>'evidence_sha256','technical_only',true));
   perform set_config('app.layaway_write',coalesce(old_layaway,'off'),true);
  end if;
  if action in ('CONSUME','RESTOCK') then
   perform app.apply_movement(link.variant_id,c.location_id,case action when 'CONSUME' then 'SALE' else 'RETURN' end,
    case when action='CONSUME' then -q else q end,'M9_WOO_PILOT',rid::text,
    jsonb_build_object('order_id',oid,'line_id',(line->>'line_id')::bigint,'barcode',link.barcode,'technical_only',true,'financial_payment_recorded',false));
   perform set_config('app.inventory_write',coalesce(old_inventory,'off'),true);
  end if;
  if action<>'RESERVE' then
   update app.m9_woo_pilot_lines set reserved_qty=reserved_qty-(case when action in ('CONSUME','RELEASE') then q else 0 end),
    consumed_qty=consumed_qty+(case when action='CONSUME' then q else 0 end),
    released_qty=released_qty+(case when action='RELEASE' then q else 0 end),
    restocked_qty=restocked_qty+(case when action='RESTOCK' then q else 0 end)
   where origin=c.origin and order_id=oid and line_id=(line->>'line_id')::bigint;
  end if;
 end loop;
 update app.m9_woo_pilot_orders set version=version+1 where origin=c.origin and order_id=oid returning * into o;
 result:=jsonb_build_object('receipt_id',rid,'order_id',oid,'operation_id',op,'action',action,'version',o.version,
  'technical_only',true,'replayed',false,'financial_payment_recorded',false);
 insert into app.m9_woo_pilot_receipts(id,origin,order_id,operation_id,actor_id,request_sha256,packet,result)
 values(rid,c.origin,oid,op,actor,h,p,result);
 insert into app.m9_woo_pilot_stock_outbox(origin,variant_id,location_id,revision,available_qty,last_receipt_id)
 select c.origin,m.variant_id,c.location_id,1,i.qty-i.reserved_qty,rid
 from jsonb_array_elements(p->'lines') x join app.m9_woo_pilot_links m on m.origin=c.origin
  and m.woo_product_id=(x->>'product_id')::bigint and m.woo_variation_id=(x->>'variation_id')::bigint
 join public.inventory_by_location i on i.variant_id=m.variant_id and i.location_id=c.location_id
 on conflict(origin,variant_id,location_id) do update set revision=app.m9_woo_pilot_stock_outbox.revision+1,
  available_qty=excluded.available_qty,last_receipt_id=excluded.last_receipt_id;
 return result;
end $$;
revoke all on function app.m9_woo_pilot_command(jsonb) from public,anon,authenticated,service_role;
comment on function app.m9_woo_pilot_command(jsonb) is 'STAGING technical stock pilot only. No financial order, public endpoint, Woo dispatch or production activation.';
commit;
