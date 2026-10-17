begin;

-- Disabled on installation. Activation/data are a separate staging-only review.
create table app.m9_rehearsal_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 review_sha256 text check(review_sha256 ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz,
 check(not enabled or (review_sha256 is not null and expires_at is not null))
);
insert into app.m9_rehearsal_control(singleton) values(true);
create table app.m9_rehearsal_allowlist (
 variant_id uuid primary key references public.variants(id),
 barcode text not null unique,
 review_sha256 text not null check(review_sha256 ~ '^[a-f0-9]{64}$'),
 expected_row jsonb not null check(jsonb_typeof(expected_row)='object'),
 check(expected_row->>'barcode'=barcode)
);
alter table app.m9_rehearsal_control enable row level security;
alter table app.m9_rehearsal_allowlist enable row level security;
revoke all on app.m9_rehearsal_control,app.m9_rehearsal_allowlist from public,anon,authenticated,service_role;

create function app.m9_rehearsal_control_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.enabled then
  perform app.assert_sicar_staging_enabled();
  if new.expires_at<=clock_timestamp() or new.expires_at>clock_timestamp()+interval '24 hours 5 minutes' then
   raise exception 'M9_REVIEW_EXPIRY_INVALID';
  end if;
 end if;
 return new;
end $$;
create trigger m9_rehearsal_control_guard before insert or update on app.m9_rehearsal_control
for each row execute function app.m9_rehearsal_control_guard();

create function app.m9_rehearsal_current_row(vid uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
select case when exists(select 1 from app.m9_sicar_products s join public.variants v on v.product_id=s.product_id where v.id=vid)
 then app.m9_sicar_current_row(vid) else app.m9_current_row(vid) end;
$$;

create function app.m9_rehearsal_status(vid uuid) returns text
language plpgsql security invoker set search_path='' as $$
declare c app.m9_rehearsal_control; a app.m9_rehearsal_allowlist;
begin
 select * into strict c from app.m9_rehearsal_control where singleton for share;
 if not c.enabled then return null; end if;
 perform app.assert_sicar_staging_enabled();
 if c.expires_at<=clock_timestamp() then return 'M9_REVIEW_EXPIRED'; end if;
 if vid is null then return 'M9_REHEARSAL_QUICK_ITEM_DISABLED'; end if;
 select * into a from app.m9_rehearsal_allowlist where variant_id=vid for share;
 if not found or a.review_sha256 is distinct from c.review_sha256 then return 'M9_VARIANT_PENDING_REVIEW'; end if;
 if a.expected_row is distinct from app.m9_rehearsal_current_row(vid) then return 'M9_VARIANT_REVIEW_CHANGED'; end if;
 return null;
end $$;

create function app.assert_m9_rehearsal_variant(vid uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare reason text;
begin
 reason:=app.m9_rehearsal_status(vid);
 if reason is not null then raise exception '%',reason using errcode='22023'; end if;
end $$;

-- Private trigger needs to read private review tables even on trusted direct
-- service writes. It grants no insert permission and checks the real POS actor
-- when enabled. Existing RLS/money/stock/authorization engines remain in place.
create function app.guard_m9_rehearsal_sale_item() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from app.m9_rehearsal_control where singleton and enabled)
  and (app.current_user_id() is null or not app.has_perm('pos.sell')) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501';
 end if;
 perform app.assert_m9_rehearsal_variant(new.variant_id);
 return new;
end $$;
create trigger m9_rehearsal_sale_guard before insert or update on public.sale_items
for each row execute function app.guard_m9_rehearsal_sale_item();
create trigger m9_rehearsal_layaway_guard before insert or update on public.layaway_items
for each row execute function app.guard_m9_rehearsal_sale_item();

-- Patch only verified anchors in the existing functions, retaining permissions,
-- cash-session checks, units of measure, amounts and all unrelated logic.
do $patch$
declare s text; anchor text;
begin
 s:=pg_get_functiondef('public.get_pos_variants(uuid,uuid[])'::regprocedure);
 anchor:='''isActive'', v.is_active and p.is_active,';
 if strpos(s,anchor)=0 then raise exception 'M9_POS_CATALOG_SOURCE_CHANGED'; end if;
 execute replace(s,anchor,'''isActive'', v.is_active and p.is_active and app.m9_rehearsal_status(v.id) is null,');
 s:=pg_get_functiondef('public.resolve_pos_scan(uuid,text)'::regprocedure);
 anchor:='v_variants := public.get_pos_variants(p_cash_session_id, v_ids);';
 if strpos(s,anchor)=0 then raise exception 'M9_POS_SCAN_SOURCE_CHANGED'; end if;
 execute replace(s,anchor,'perform app.assert_m9_rehearsal_variant(v_ids[1]);'||chr(10)||'  '||anchor);
end $patch$;

revoke all on function app.m9_rehearsal_control_guard(),app.m9_rehearsal_current_row(uuid),app.m9_rehearsal_status(uuid),app.assert_m9_rehearsal_variant(uuid),app.guard_m9_rehearsal_sale_item() from public,anon,authenticated,service_role;
commit;
