begin;

-- Notas personales globales de la cuenta; compartidas sólo en una tienda.
-- No se copian textos privados a audit_log, accesible por administración.
create table public.workspace_notes (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references public.app_users(id),
  location_id uuid references public.locations(id),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspace_notes_author_updated_idx
  on public.workspace_notes(author_user_id, updated_at desc) where location_id is null;
create index workspace_notes_location_updated_idx
  on public.workspace_notes(location_id, updated_at desc) where location_id is not null;
alter table public.workspace_notes enable row level security;
revoke all on public.workspace_notes from public, anon, authenticated, service_role;

-- Toda operación entra por estas funciones: autor derivado de la sesión,
-- sin parámetro para suplantarlo y sin operación de borrado.
create function public.list_workspace_notes(p_location_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select app.current_user_id());
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_location_id is not null and (
    not (select app.can_access_location(p_location_id)) or not exists (
      select 1 from public.locations where id = p_location_id and is_active and type = 'STORE'
    )
  ) then
    raise exception 'LOCATION_NOT_ALLOWED' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(n) order by n.updated_at desc, n.id) from (
    select n.id, n.body, n.location_id, n.author_user_id, u.full_name as author_name,
      n.created_at, n.updated_at, n.revision
    from public.workspace_notes n join public.app_users u on u.id = n.author_user_id
    where (n.location_id is null and n.author_user_id = v_actor)
      or (p_location_id is not null and n.location_id = p_location_id)
    order by n.updated_at desc, n.id limit 100
  ) n), '[]'::jsonb);
end;
$$;

create function public.save_workspace_note(
  p_body text, p_location_id uuid default null,
  p_id uuid default null, p_expected_revision integer default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_note public.workspace_notes%rowtype;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'INVALID_NOTE' using errcode = '22023';
  end if;
  if p_id is not null then
    select * into v_note from public.workspace_notes where id = p_id for update;
    if not found or v_note.author_user_id <> v_actor then
      raise exception 'NOTE_NOT_EDITABLE' using errcode = '42501';
    end if;
    if v_note.location_id is distinct from p_location_id then
      raise exception 'NOTE_SCOPE_IMMUTABLE' using errcode = '22023';
    end if;
    if p_expected_revision is distinct from v_note.revision then
      raise exception 'NOTE_CHANGED' using errcode = '40001';
    end if;
  end if;
  if p_location_id is not null and (
    not (select app.can_access_location(p_location_id)) or not exists (
      select 1 from public.locations where id = p_location_id and is_active and type = 'STORE'
    )
  ) then
    raise exception 'LOCATION_NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.workspace_notes(author_user_id, location_id, body)
      values (v_actor, p_location_id, btrim(p_body)) returning * into v_note;
  else
    update public.workspace_notes set body = btrim(p_body), revision = revision + 1,
      updated_at = clock_timestamp() where id = p_id returning * into v_note;
  end if;
  return to_jsonb(v_note) || jsonb_build_object('author_name', (
    select full_name from public.app_users where id = v_actor
  ));
end;
$$;
revoke execute on function public.list_workspace_notes(uuid) from public, anon;
revoke execute on function public.save_workspace_note(text, uuid, uuid, integer) from public, anon;
grant execute on function public.list_workspace_notes(uuid) to authenticated;
grant execute on function public.save_workspace_note(text, uuid, uuid, integer) to authenticated;

commit;
