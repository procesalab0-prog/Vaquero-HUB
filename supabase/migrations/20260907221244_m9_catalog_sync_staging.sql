begin;

-- M9 — Sincronizador transaccional e idempotente de catálogo SICAR.
--
-- Esta migración crea la infraestructura, pero nace BLOQUEADA. Cada entorno
-- debe habilitarla explícitamente como STAGING; aun aplicada por accidente en
-- producción, ninguna función puede escribir catálogo.
create table app.sicar_sync_control (
  singleton boolean primary key default true check (singleton),
  environment_label text not null default 'UNCONFIGURED'
    check (environment_label in ('UNCONFIGURED', 'STAGING')),
  catalog_writes_enabled boolean not null default false,
  configured_at timestamptz,
  configured_by text
);

insert into app.sicar_sync_control(singleton) values (true);

create table app.sicar_import_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  source_sha256 text not null unique check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_file text not null check (length(btrim(source_file)) between 1 and 255),
  source_sheet text not null check (length(btrim(source_sheet)) between 1 and 255),
  report_sha256 text not null check (report_sha256 ~ '^[a-f0-9]{64}$'),
  expected_rows integer not null check (expected_rows between 1 and 100000),
  barcode_symbology text not null check (barcode_symbology in ('EAN13', 'CODE128', 'LEGACY')),
  barcode_test_reference text not null check (length(btrim(barcode_test_reference)) between 3 and 500),
  approved_by uuid not null references public.app_users(id),
  status text not null default 'STAGING'
    check (status in ('STAGING', 'APPLIED')),
  result jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index sicar_import_runs_status_created_idx
  on app.sicar_import_runs(status, created_at desc);

create table app.sicar_import_rows (
  run_id uuid not null references app.sicar_import_runs(id) on delete cascade,
  row_number integer not null check (row_number >= 2),
  legacy_key text not null check (legacy_key ~ '^[0-9]+$'),
  description text not null check (btrim(description) <> ''),
  characteristics text,
  department_name text,
  category_name text,
  cost_cents bigint not null check (cost_cents >= 0),
  price_cents bigint not null check (price_cents > 0),
  is_active boolean not null,
  row_fingerprint text not null check (row_fingerprint ~ '^[a-f0-9]{64}$'),
  primary key (run_id, row_number),
  unique (run_id, legacy_key)
);

create index sicar_import_rows_key_idx on app.sicar_import_rows(legacy_key);

create table app.sicar_catalog_links (
  legacy_key text primary key check (legacy_key ~ '^[0-9]+$'),
  variant_id uuid not null unique references public.variants(id),
  first_run_id uuid not null references app.sicar_import_runs(id),
  last_run_id uuid not null references app.sicar_import_runs(id),
  source_row_number integer not null,
  department_name text,
  source_category_name text,
  row_fingerprint text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index sicar_catalog_links_last_run_idx on app.sicar_catalog_links(last_run_id);

alter table app.sicar_sync_control enable row level security;
alter table app.sicar_import_runs enable row level security;
alter table app.sicar_import_rows enable row level security;
alter table app.sicar_catalog_links enable row level security;

create or replace function app.assert_sicar_staging_enabled()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control app.sicar_sync_control;
begin
  select * into v_control from app.sicar_sync_control where singleton = true;
  if not found or v_control.environment_label <> 'STAGING'
     or not v_control.catalog_writes_enabled then
    raise exception 'SICAR_CATALOG_SYNC_DISABLED' using errcode = '42501';
  end if;
end;
$$;

create or replace function app.sicar_approver(p_employee_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  select u.id into v_user_id
  from public.app_users u
  join public.role_permissions creator
    on creator.role_id = u.role_id and creator.permission_code = 'products.create'
  join public.role_permissions updater
    on updater.role_id = u.role_id and updater.permission_code = 'products.update'
  where u.employee_code = upper(btrim(p_employee_code)) and u.is_active;
  if v_user_id is null then
    raise exception 'SICAR_APPROVER_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

create or replace function public.configure_sicar_catalog_staging(
  p_project_ref text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_project_ref <> 'zsezjtswqeijboezvado'
     or p_confirmation <> 'ENABLE CATALOG ONLY' then
    raise exception 'SICAR_STAGING_CONFIRMATION_MISMATCH' using errcode = '42501';
  end if;
  update app.sicar_sync_control set
    environment_label = 'STAGING', catalog_writes_enabled = true,
    configured_at = now(), configured_by = 'explicit-service-confirmation'
  where singleton = true;
  return jsonb_build_object('environment', 'STAGING',
    'catalog_writes_enabled', true, 'inventory_writes_enabled', false);
end;
$$;

create or replace function public.stage_sicar_catalog_run(
  p_source_sha256 text,
  p_source_file text,
  p_source_sheet text,
  p_report_sha256 text,
  p_expected_rows integer,
  p_barcode_symbology text,
  p_barcode_test_reference text,
  p_approved_by_employee_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run app.sicar_import_runs;
  v_approver uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform app.assert_sicar_staging_enabled();
  v_approver := app.sicar_approver(p_approved_by_employee_code);
  if lower(btrim(coalesce(p_source_sha256, ''))) !~ '^[a-f0-9]{64}$'
     or lower(btrim(coalesce(p_report_sha256, ''))) !~ '^[a-f0-9]{64}$'
     or coalesce(p_expected_rows, 0) not between 1 and 100000
     or upper(btrim(coalesce(p_barcode_symbology, ''))) not in ('EAN13', 'CODE128', 'LEGACY')
     or length(btrim(coalesce(p_barcode_test_reference, ''))) not between 3 and 500 then
    raise exception 'INVALID_SICAR_RUN' using errcode = '22023';
  end if;

  select * into v_run from app.sicar_import_runs
  where source_sha256 = lower(btrim(p_source_sha256)) for update;
  if found then
    if v_run.report_sha256 <> lower(btrim(p_report_sha256))
       or v_run.expected_rows <> p_expected_rows
       or v_run.barcode_symbology <> upper(btrim(p_barcode_symbology)) then
      raise exception 'SICAR_RUN_METADATA_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_run.id, 'status', v_run.status,
      'already_applied', v_run.status = 'APPLIED', 'result', v_run.result);
  end if;

  insert into app.sicar_import_runs(
    source_sha256, source_file, source_sheet, report_sha256, expected_rows,
    barcode_symbology, barcode_test_reference, approved_by
  ) values (
    lower(btrim(p_source_sha256)), btrim(p_source_file), btrim(p_source_sheet),
    lower(btrim(p_report_sha256)), p_expected_rows,
    upper(btrim(p_barcode_symbology)), btrim(p_barcode_test_reference), v_approver
  ) returning * into v_run;
  return jsonb_build_object('id', v_run.id, 'status', v_run.status,
    'already_applied', false);
end;
$$;

create or replace function public.stage_sicar_catalog_rows(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run app.sicar_import_runs;
  v_row record;
  v_existing app.sicar_import_rows;
  v_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform app.assert_sicar_staging_enabled();
  if p_run_id is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'INVALID_SICAR_BATCH' using errcode = '22023';
  end if;
  select * into v_run from app.sicar_import_runs where id = p_run_id for update;
  if not found then raise exception 'SICAR_RUN_NOT_FOUND' using errcode = '22023'; end if;
  if v_run.status = 'APPLIED' then
    return jsonb_build_object('run_id', v_run.id, 'staged', 0, 'already_applied', true);
  end if;

  for v_row in
    select * from jsonb_to_recordset(p_rows) as x(
      row_number integer, legacy_key text, description text,
      characteristics text, department_name text, category_name text,
      cost_cents bigint, price_cents bigint, is_active boolean,
      row_fingerprint text
    )
  loop
    if v_row.row_number < 2 or coalesce(v_row.legacy_key, '') !~ '^[0-9]+$'
       or nullif(btrim(v_row.description), '') is null
       or v_row.cost_cents is null or v_row.cost_cents < 0
       or v_row.price_cents is null or v_row.price_cents <= 0
       or v_row.is_active is null
       or coalesce(v_row.row_fingerprint, '') !~ '^[a-f0-9]{64}$' then
      raise exception 'INVALID_SICAR_ROW:%', coalesce(v_row.row_number, 0) using errcode = '22023';
    end if;
    select * into v_existing from app.sicar_import_rows
    where run_id = p_run_id and row_number = v_row.row_number;
    if found then
      if v_existing.row_fingerprint <> v_row.row_fingerprint
         or v_existing.legacy_key <> v_row.legacy_key then
        raise exception 'SICAR_STAGED_ROW_CONFLICT:%', v_row.row_number using errcode = '22023';
      end if;
    else
      insert into app.sicar_import_rows(
        run_id, row_number, legacy_key, description, characteristics,
        department_name, category_name, cost_cents, price_cents, is_active,
        row_fingerprint
      ) values (
        p_run_id, v_row.row_number, v_row.legacy_key, btrim(v_row.description),
        nullif(btrim(v_row.characteristics), ''), nullif(btrim(v_row.department_name), ''),
        nullif(btrim(v_row.category_name), ''), v_row.cost_cents, v_row.price_cents,
        v_row.is_active, v_row.row_fingerprint
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('run_id', v_run.id, 'staged', v_count,
    'total_staged', (select count(*) from app.sicar_import_rows where run_id = p_run_id));
exception
  when unique_violation then
    raise exception 'SICAR_DUPLICATE_KEY_OR_ROW' using errcode = '23505';
end;
$$;

create or replace function public.apply_sicar_catalog_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run app.sicar_import_runs;
  v_row app.sicar_import_rows;
  v_category_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_legacy_variant_id uuid;
  v_barcode_variant_id uuid;
  v_barcode_source text;
  v_serial bigint;
  v_sku text;
  v_result jsonb;
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_zero_cost_preserved integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform app.assert_sicar_staging_enabled();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sicar-catalog-sync', 0));
  select * into v_run from app.sicar_import_runs where id = p_run_id for update;
  if not found then raise exception 'SICAR_RUN_NOT_FOUND' using errcode = '22023'; end if;
  if v_run.status = 'APPLIED' then
    return v_run.result || jsonb_build_object('already_applied', true);
  end if;
  if (select count(*) from app.sicar_import_rows where run_id = p_run_id) <> v_run.expected_rows then
    raise exception 'SICAR_RUN_INCOMPLETE' using errcode = '22023';
  end if;

  for v_row in
    select * from app.sicar_import_rows where run_id = p_run_id order by row_number
  loop
    v_legacy_variant_id := null;
    v_barcode_variant_id := null;
    v_barcode_source := null;
    select id into v_legacy_variant_id from public.variants
      where legacy_sicar_code = v_row.legacy_key;
    select variant_id, source into v_barcode_variant_id, v_barcode_source
      from public.barcodes where code = v_row.legacy_key;
    if v_legacy_variant_id is not null and v_barcode_variant_id is not null
       and v_legacy_variant_id <> v_barcode_variant_id then
      raise exception 'SICAR_IDENTITY_CONFLICT:%', v_row.legacy_key using errcode = '23505';
    end if;
    if v_barcode_source = 'GENERATED' and v_legacy_variant_id is null then
      raise exception 'SICAR_RESERVED_BARCODE_CONFLICT:%', v_row.legacy_key using errcode = '23505';
    end if;
    v_variant_id := coalesce(v_legacy_variant_id, v_barcode_variant_id);

    select id into v_category_id from public.categories
      where lower(btrim(name)) = lower(btrim(coalesce(v_row.category_name, 'Sin categoría SICAR')));
    if v_category_id is null then
      insert into public.categories(name) values(coalesce(v_row.category_name, 'Sin categoría SICAR'))
      returning id into v_category_id;
    else
      update public.categories set is_active = true where id = v_category_id and not is_active;
    end if;

    if v_variant_id is null then
      insert into public.products(name, category_id, description, is_active, created_by, updated_by)
      values(v_row.description, v_category_id, v_row.characteristics, v_row.is_active,
        v_run.approved_by, v_run.approved_by)
      returning id into v_product_id;
      v_serial := nextval('app.variant_serial_seq');
      v_sku := v_serial::text || '-' || app.luhn_check_digit(v_serial::text)::text;
      insert into public.variants(product_id, sku, cost_cents, price_cents,
        legacy_sicar_code, is_active, created_by, updated_by)
      values(v_product_id, v_sku, v_row.cost_cents, v_row.price_cents,
        v_row.legacy_key, v_row.is_active, v_run.approved_by, v_run.approved_by)
      returning id into v_variant_id;
      insert into public.barcodes(variant_id, code, symbology, source, is_primary)
      values(v_variant_id, v_row.legacy_key, v_run.barcode_symbology, 'SICAR', true);
      v_created := v_created + 1;
    else
      select product_id into v_product_id from public.variants where id = v_variant_id for update;
      if not exists(select 1 from app.sicar_catalog_links where variant_id = v_variant_id)
         and exists(select 1 from public.variants where id = v_variant_id and legacy_sicar_code is not null
           and legacy_sicar_code <> v_row.legacy_key) then
        raise exception 'SICAR_VARIANT_ALREADY_LINKED:%', v_row.legacy_key using errcode = '23505';
      end if;
      if exists(
        select 1 from public.products p join public.variants v on v.product_id = p.id
        where v.id = v_variant_id and (
          p.name is distinct from v_row.description
          or p.category_id is distinct from v_category_id
          or coalesce(p.description, '') is distinct from coalesce(v_row.characteristics, '')
          or p.is_active is distinct from v_row.is_active
          or v.price_cents is distinct from v_row.price_cents
          or (v_row.cost_cents > 0 and v.cost_cents is distinct from v_row.cost_cents)
          or v.is_active is distinct from v_row.is_active
          or v.legacy_sicar_code is null
        )
      ) then
        update public.products set name = v_row.description, category_id = v_category_id,
          description = v_row.characteristics, is_active = v_row.is_active,
          updated_by = v_run.approved_by
        where id = v_product_id;
        update public.variants set
          cost_cents = case when v_row.cost_cents = 0 and cost_cents > 0 then cost_cents else v_row.cost_cents end,
          price_cents = v_row.price_cents,
          legacy_sicar_code = coalesce(legacy_sicar_code, v_row.legacy_key),
          is_active = v_row.is_active, updated_by = v_run.approved_by
        where id = v_variant_id;
        v_updated := v_updated + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
      if v_row.cost_cents = 0 and (select cost_cents from public.variants where id = v_variant_id) > 0 then
        v_zero_cost_preserved := v_zero_cost_preserved + 1;
      end if;
      if v_barcode_variant_id is null then
        insert into public.barcodes(variant_id, code, symbology, source, is_primary)
        values(v_variant_id, v_row.legacy_key, v_run.barcode_symbology, 'SICAR',
          not exists(select 1 from public.barcodes where variant_id = v_variant_id and is_primary));
      end if;
    end if;

    insert into app.sicar_catalog_links(
      legacy_key, variant_id, first_run_id, last_run_id, source_row_number,
      department_name, source_category_name, row_fingerprint
    ) values (
      v_row.legacy_key, v_variant_id, v_run.id, v_run.id, v_row.row_number,
      v_row.department_name, v_row.category_name, v_row.row_fingerprint
    ) on conflict(legacy_key) do update set
      last_run_id = excluded.last_run_id,
      source_row_number = excluded.source_row_number,
      department_name = excluded.department_name,
      source_category_name = excluded.source_category_name,
      row_fingerprint = excluded.row_fingerprint,
      last_seen_at = now()
    where app.sicar_catalog_links.variant_id = excluded.variant_id;
    if not found then
      raise exception 'SICAR_LINK_CONFLICT:%', v_row.legacy_key using errcode = '23505';
    end if;
  end loop;

  v_result := jsonb_build_object(
    'run_id', v_run.id, 'source_sha256', v_run.source_sha256,
    'rows', v_run.expected_rows, 'created', v_created, 'updated', v_updated,
    'unchanged', v_unchanged, 'zero_cost_preserved', v_zero_cost_preserved,
    'inventory_rows_touched', 0, 'absent_products_deactivated', 0,
    'already_applied', false
  );
  update app.sicar_import_runs set status = 'APPLIED', result = v_result, applied_at = now()
  where id = v_run.id;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, after_data, metadata)
  values(v_run.approved_by, 'sicar.catalog.applied', 'sicar_import_runs', v_run.id::text,
    v_result, jsonb_build_object('source_file', v_run.source_file,
      'report_sha256', v_run.report_sha256, 'barcode_test_reference', v_run.barcode_test_reference));
  return v_result;
end;
$$;

revoke all on app.sicar_sync_control, app.sicar_import_runs,
  app.sicar_import_rows, app.sicar_catalog_links from public, anon, authenticated, service_role;
grant select, insert, update, delete on app.sicar_sync_control, app.sicar_import_runs,
  app.sicar_import_rows, app.sicar_catalog_links to service_role;

revoke execute on function app.assert_sicar_staging_enabled(), app.sicar_approver(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.stage_sicar_catalog_run(text,text,text,text,integer,text,text,text),
  public.stage_sicar_catalog_rows(uuid,jsonb), public.apply_sicar_catalog_run(uuid),
  public.configure_sicar_catalog_staging(text,text)
  from public, anon, authenticated;
grant execute on function public.stage_sicar_catalog_run(text,text,text,text,integer,text,text,text),
  public.stage_sicar_catalog_rows(uuid,jsonb), public.apply_sicar_catalog_run(uuid),
  public.configure_sicar_catalog_staging(text,text)
  to service_role;

commit;
