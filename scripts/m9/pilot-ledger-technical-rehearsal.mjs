import { digest } from "./acceleration.mjs";
import { quoteDoText } from "./sql-literal.mjs";
import { createHash } from "node:crypto";

// Uses observed quantities solely as transient QA inputs. Does NOT certify
// source physical stock, reservations, sale readiness or cutover quantities.
// No COMMIT path, no permanent function, no inventory trigger bypass.
export function pilotLedgerTechnicalRehearsal(
  review,
  snapshot,
  observationsRaw,
) {
  if (
    review.version !== "m9-sicar-pilot-evidence-1" ||
    review.mode !== "OFFLINE_READ_ONLY" ||
    review.production_allowed !== false ||
    review.inventory_import_allowed !== false ||
    review.activation_allowed !== false ||
    review.source_observation_is_not_physical_count !== true ||
    snapshot.project_id !== "zsezjtswqeijboezvado" ||
    !snapshot.control?.enabled ||
    !review.rows?.length ||
    review.rows.length > 20
  )
    throw Error("TECHNICAL_STAGING_REVIEW_REQUIRED");
  if (
    !observationsRaw ||
    createHash("sha256").update(observationsRaw).digest("hex") !==
      review.inputs?.observations
  )
    throw Error("PINNED_SOURCE_OBSERVATIONS_REQUIRED");
  const observations = JSON.parse(observationsRaw),
    observed = new Map(observations.map((o) => [o.barcode, o]));
  if (
    observed.size !== review.rows.length ||
    observed.size !== observations.length ||
    review.rows.some((r) => {
      const o = observed.get(r.barcode);
      return (
        !o ||
        digest(o) !== r.observation_sha256 ||
        o.observed_label.match(/^ALMACENES\s+(\d+) PZA$/)?.[1] !==
          r.observed_source_qty
      );
    })
  )
    throw Error("TECHNICAL_OBSERVED_QUANTITY_CHANGED");
  if (
    review.identity_sha256 !==
    digest(
      review.rows.map(({ barcode, variant_id, product_id }) => ({
        barcode,
        variant_id,
        product_id,
      })),
    )
  )
    throw Error("TECHNICAL_IDENTITY_CHANGED");
  const location = snapshot.locations?.find(
    (l) => l.id === snapshot.proposed_location_id,
  );
  if (location?.type !== "STORE" || !location.is_active)
    throw Error("ACTIVE_STORE_REQUIRED");
  if (snapshot.rows?.length !== review.rows.length)
    throw Error("EXACT_TECHNICAL_SCOPE_REQUIRED");
  const rows = review.rows.map((r) => {
    const d = snapshot.rows.find((d) => d.barcode === r.barcode);
    if (
      !d ||
      d.variant_id !== r.variant_id ||
      d.product_id !== r.product_id ||
      d.location_id !== location.id ||
      !d.stored_matches ||
      !d.review_matches ||
      !d.barcode_matches ||
      !d.is_active ||
      d.unit_code !== "PIECE" ||
      d.current?.cost_cents !== null ||
      r.cost_cents !== null ||
      r.physical_qty !== null ||
      r.reserved_qty !== null ||
      r.available_qty !== null ||
      typeof r.observed_source_qty !== "string" ||
      !/^\d{1,9}$/.test(r.observed_source_qty ?? "") ||
      Number(r.observed_source_qty) <= 0 ||
      r.import_allowed !== false ||
      (d.balance_present
        ? Number(d.qty) !== 0 || Number(d.reserved_qty) !== 0
        : d.qty !== null || d.reserved_qty !== null)
    )
      throw Error("NONEMPTY_OR_CHANGED_TECHNICAL_BASELINE");
    return {
      barcode: r.barcode,
      variant_id: r.variant_id,
      product_id: r.product_id,
      qty: r.observed_source_qty,
      current: d.current,
    };
  });
  if (
    new Set(rows.map((r) => r.barcode)).size !== rows.length ||
    new Set(rows.map((r) => r.variant_id)).size !== rows.length
  )
    throw Error("DUPLICATE_TECHNICAL_IDENTITY");
  const tables = [
    "public.variants",
    "public.products",
    "public.barcodes",
    "public.inventory_by_location",
    "public.inventory_movements",
    "public.sales",
    "public.sale_items",
    "public.sale_payments",
    "public.cash_movements",
    "public.returns",
    "public.return_items",
    "public.return_payments",
    "app.supervisor_authorizations",
    "public.idempotency_keys",
    "public.folios",
    "public.audit_log",
    "app.m9_rehearsal_control",
    "app.m9_rehearsal_allowlist",
  ];
  if (
    tables.some(
      (t) =>
        !Number.isSafeInteger(snapshot.audit?.[t]?.count) ||
        !/^[a-f0-9]{32}$/.test(snapshot.audit[t].md5 ?? ""),
    )
  )
    throw Error("FULL_AUDIT_REQUIRED");
  const q = (s) => quoteDoText(s, "$ledger$"),
    reference =
      "M9-QA-OBSERVED-" +
      digest({ identity: review.identity_sha256, snapshot, rows });
  const verify = (t) =>
    `if (select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(row::text,'' order by row::text),''))) from (select to_jsonb(t) row from ${t} t) x) is distinct from ${q(JSON.stringify(snapshot.audit[t]))}::jsonb then raise exception 'LEDGER_BASELINE_CHANGED: ${t}';end if;`;
  return `-- TECHNICAL QA ONLY: observed quantities, not approved stock or reserves.\nbegin;\nset local standard_conforming_strings=on;\nset local statement_timeout='120s';\nset local lock_timeout='5s';\nlock table public.inventory_by_location,public.inventory_movements,app.m9_rehearsal_control,app.m9_rehearsal_allowlist in share row exclusive mode;\ncreate temporary table pilot_ledger_result(result jsonb) on commit drop;\ndo $ledger$\ndeclare r jsonb;actor uuid;ref text:=${q(reference)};existing public.inventory_movements;first_pass integer:=0;replayed integer:=0;seq_before bigint;\nbegin\n perform app.assert_sicar_staging_enabled();\n if clock_timestamp()>${q(snapshot.captured_at)}::timestamptz+interval '1 hour' or clock_timestamp()<${q(snapshot.captured_at)}::timestamptz then raise exception 'LEDGER_SNAPSHOT_STALE';end if;\n if not exists(select 1 from app.m9_rehearsal_control where singleton and enabled and expires_at<clock_timestamp()) then raise exception 'EXPIRED_SALE_GUARD_MUST_REMAIN_ENABLED';end if;\n ${tables.map(verify).join("\n")}\n select cashier_user_id into strict actor from public.cash_sessions where status='OPEN' order by opened_at desc limit 1;\n if not exists(select 1 from public.app_users u join public.roles rr on rr.id=u.role_id where u.id=actor and u.is_active and rr.code='ADMIN') then raise exception 'ADMIN_FIXTURE_REQUIRED';end if;\n perform set_config('request.jwt.claim.sub',actor::text,true);\n if not exists(select 1 from public.locations where id=${q(location.id)}::uuid and type='STORE' and is_active) then raise exception 'STORE_CHANGED';end if;\n for r in select value from jsonb_array_elements(${q(JSON.stringify(rows))}::jsonb) loop\n  if app.m9_rehearsal_current_row((r->>'variant_id')::uuid) is distinct from r->'current' or not exists(select 1 from app.m9_rows mr join app.m9_rehearsal_allowlist a on a.variant_id=mr.variant_id where mr.variant_id=(r->>'variant_id')::uuid and mr.barcode=r->>'barcode' and mr.source_row=r->'current' and a.expected_row=r->'current') or not exists(select 1 from public.barcodes b join public.variants v on v.id=b.variant_id join public.products p on p.id=v.product_id where b.variant_id=(r->>'variant_id')::uuid and b.code=r->>'barcode' and b.source='SICAR' and v.product_id=(r->>'product_id')::uuid and v.is_active and p.is_active and p.measure_unit_code='PIECE' and v.cost_cents is null) then raise exception 'TECHNICAL_CATALOG_CHANGED';end if;\n  if exists(select 1 from public.inventory_by_location where variant_id=(r->>'variant_id')::uuid and location_id=${q(location.id)}::uuid and (qty<>0 or reserved_qty<>0)) then raise exception 'TECHNICAL_BALANCE_NOT_ZERO';end if;\n  perform app.apply_movement((r->>'variant_id')::uuid,${q(location.id)}::uuid,'INITIAL_IMPORT',(r->>'qty')::numeric,'M9_TECHNICAL_ROLLBACK',ref,jsonb_build_object('technical_only',true,'source_physical_verified',false,'source_reservations_imported',false,'barcode',r->>'barcode'));first_pass:=first_pass+1;\n end loop;\n -- Replay checks the existing movement and never calls apply_movement twice.\n for r in select value from jsonb_array_elements(${q(JSON.stringify(rows))}::jsonb) loop\n  select * into strict existing from public.inventory_movements where movement_type='INITIAL_IMPORT' and reference_type='M9_TECHNICAL_ROLLBACK' and reference_id=ref and variant_id=(r->>'variant_id')::uuid and location_id=${q(location.id)}::uuid;\n  if existing.quantity<>(r->>'qty')::numeric or existing.previous_qty<>0 or existing.new_qty<>(r->>'qty')::numeric or existing.metadata->>'barcode'<>r->>'barcode' then raise exception 'TECHNICAL_REPLAY_CONFLICT';end if;replayed:=replayed+1;\n  if not exists(select 1 from public.inventory_by_location where variant_id=(r->>'variant_id')::uuid and location_id=${q(location.id)}::uuid and qty=(r->>'qty')::numeric and reserved_qty=0) then raise exception 'TECHNICAL_POST_BALANCE_CHANGED';end if;\n  if app.m9_rehearsal_status((r->>'variant_id')::uuid) is distinct from 'M9_REVIEW_EXPIRED' then raise exception 'TECHNICAL_SALE_BYPASS';end if;\n end loop;\n if (select count(*) from public.inventory_movements where reference_type='M9_TECHNICAL_ROLLBACK' and reference_id=ref)<>${rows.length} then raise exception 'TECHNICAL_REPLAY_DUPLICATED';end if;\n ${tables
    .filter(
      (t) =>
        ![
          "public.inventory_by_location",
          "public.inventory_movements",
        ].includes(t),
    )
    .map(verify)
    .join(
      "\n",
    )}\n set constraints all immediate;\n insert into pilot_ledger_result values(jsonb_build_object('mode','TECHNICAL_ROLLBACK_NOT_STOCK_APPROVAL','codes',first_pass,'replay_without_new_movements',replayed,'qa_units',${rows.reduce((n, r) => n + Number(r.qty), 0)},'source_reservations_imported',false,'source_physical_stock_approved',false,'sales_activated',false,'financial_history_unchanged',true,'permanent_stock_loaded',false));\nend $ledger$;\nselect * from pilot_ledger_result;\nrollback;\n`;
}
