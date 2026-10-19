begin;

-- Receiving a previously sold article remains possible after a review expires.
-- Delivering a replacement is a new stock outflow and needs the same review as
-- a sale. Existing immutable-ledger, PIN, cash and stock guards remain intact.
create function app.guard_m9_rehearsal_exchange_item() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.direction='OUT' then
  if exists(select 1 from app.m9_rehearsal_control where singleton and enabled)
   and (app.current_user_id() is null or not app.has_perm('returns.create') or not app.has_perm('pos.sell')) then
   raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  perform app.assert_m9_rehearsal_variant(new.variant_id);
 end if;
 return new;
end $$;
revoke all on function app.guard_m9_rehearsal_exchange_item() from public,anon,authenticated,service_role;
create trigger m9_rehearsal_exchange_guard before insert or update on public.return_items
for each row execute function app.guard_m9_rehearsal_exchange_item();

-- Filter before ORDER/LIMIT so hidden candidates do not consume visible slots.
-- Patch the shared search used by both RPC versions, retaining their permissions.
do $patch$
declare source text; anchor text:='where v.is_active and p.is_active and i.qty - i.reserved_qty > 0';
begin
 source:=pg_get_functiondef('public.search_exchange_variants(text,uuid,integer)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'M9_EXCHANGE_SEARCH_SOURCE_CHANGED';
 end if;
 execute replace(source,anchor,anchor||chr(10)||'    and app.m9_rehearsal_status(v.id) is null');
end $patch$;

commit;
