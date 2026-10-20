import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { digest } from "./acceleration.mjs";
import { quoteDoText } from "./sql-literal.mjs";

const PROJECT = "zsezjtswqeijboezvado";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const json = (v) => JSON.stringify(v, null, 2) + "\n";
const text = (s) => typeof s === "string" && !!s.trim() && s === s.trim();
const hash = (s) => /^[a-f0-9]{64}$/.test(s ?? "");
const uuid = (s) => /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s ?? "");
const quantity = (s) =>
  typeof s === "string" && /^(0|[1-9]\d{0,8})(\.0{1,3})?$/.test(s);
const date = (s) =>
  typeof s === "string" &&
  /T.*(Z|[+-]\d\d:\d\d)$/.test(s) &&
  Number.isFinite(Date.parse(s));
const fresh = (s, at, hours) =>
  date(s) &&
  Date.parse(s) <= Date.parse(at) &&
  Date.parse(at) - Date.parse(s) <= hours * 3600000;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Offline readiness only. Even a complete evidence sheet is not an import or
// an activation authorization. There is deliberately no stock writer here.
export function pilotStockPlan(renewal, snapshot, evidence, assessmentAt) {
  const pilot = renewal.pilot;
  if (
    renewal.version !== "m9-renewed-pilot-1" ||
    renewal.project_id !== PROJECT ||
    snapshot.project_id !== PROJECT ||
    renewal.production_allowed !== false ||
    renewal.inventory_import_allowed !== false ||
    renewal.activation_allowed !== false ||
    !snapshot.control?.enabled ||
    !date(assessmentAt)
  )
    throw Error("GUARDED_RENEWED_PILOT_REQUIRED");
  if (
    !pilot?.rows?.length ||
    pilot.rows.length > 20 ||
    pilot.identity_sha256 !==
      digest(
        pilot.rows.map(({ barcode, variant_id, product_id }) => ({
          barcode,
          variant_id,
          product_id,
        })),
      )
  )
    throw Error("PILOT_IDENTITY_CHANGED");
  const location = snapshot.locations?.find(
    (l) => l.id === snapshot.proposed_location_id,
  );
  if (!location?.is_active || location.type !== "STORE" || !uuid(location.id))
    throw Error("ACTIVE_STORE_REQUIRED");
  const codes = new Set(),
    ids = new Set(),
    live = new Map();
  for (const d of snapshot.rows ?? []) {
    if (!text(d.barcode) || live.has(d.barcode))
      throw Error("DUPLICATE_DESTINATION_CODE");
    live.set(d.barcode, d);
  }
  for (const p of pilot.rows) {
    if (
      !text(p.barcode) ||
      codes.has(p.barcode) ||
      !uuid(p.variant_id) ||
      !uuid(p.product_id) ||
      ids.has(p.variant_id)
    )
      throw Error("DUPLICATE_OR_INVALID_PILOT_IDENTITY");
    codes.add(p.barcode);
    ids.add(p.variant_id);
    const d = live.get(p.barcode);
    if (
      !d ||
      d.variant_id !== p.variant_id ||
      d.product_id !== p.product_id ||
      d.location_id !== location.id ||
      d.current?.barcode !== p.barcode ||
      !d.stored_matches ||
      !d.review_matches ||
      !d.barcode_matches ||
      !d.is_active ||
      d.unit_code !== "PIECE"
    )
      throw Error("LIVE_IDENTITY_OR_REVIEW_CHANGED");
    const expected = {
      barcode: p.barcode,
      description: p.source_description,
      department: p.department,
      section: p.section,
      price_cents: p.public_price_cents,
      cost_cents: null,
      product_name: p.product_name,
      attributes: p.attributes,
      woo_product_id: p.woo_product_id,
      woo_variation_id: p.woo_variation_id,
    };
    if (
      digest(d.current) !== digest(expected) ||
      p.source_warehouse !== "default" ||
      p.cost_cents !== null
    )
      throw Error("PILOT_CATALOG_CHANGED");
    if (
      typeof d.balance_present !== "boolean" ||
      !Number.isSafeInteger(d.movement_count) ||
      d.movement_count < 0 ||
      (d.balance_present
        ? !quantity(d.qty) || !quantity(d.reserved_qty)
        : d.qty !== null || d.reserved_qty !== null)
    )
      throw Error("EXPLICIT_BALANCE_BASELINE_REQUIRED");
  }
  if (live.size !== codes.size) throw Error("EXACT_PILOT_SNAPSHOT_REQUIRED");
  const template = {
    pilot_identity_sha256: pilot.identity_sha256,
    warehouse: {
      source_warehouse: "default",
      source_facility: null,
      target_location_id: location.id,
      scope: null,
      quantity_meaning: null,
      confirmed_by: null,
      confirmed_at: null,
      evidence_sha256: null,
    },
    stock: {
      captured_at: null,
      confirmed_by: null,
      evidence_sha256: null,
      source_warehouse: "default",
      source_facility: null,
      includes_reservations: null,
      rows: pilot.rows.map((p) => ({
        barcode: p.barcode,
        physical_qty: null,
        reserved_qty: null,
      })),
    },
  };
  evidence ??= template;
  if (
    evidence.pilot_identity_sha256 !== pilot.identity_sha256 ||
    !Array.isArray(evidence.stock?.rows)
  )
    throw Error("EVIDENCE_SCOPE_CHANGED");
  const supplied = new Map();
  for (const r of evidence.stock.rows) {
    if (!text(r.barcode) || !codes.has(r.barcode) || supplied.has(r.barcode))
      throw Error("EXTRA_DUPLICATE_OR_NONLITERAL_STOCK_CODE");
    supplied.set(r.barcode, r);
  }
  const blockers = [];
  if (!fresh(snapshot.captured_at, assessmentAt, 1))
    blockers.push("DESTINATION_SNAPSHOT_STALE");
  const w = evidence.warehouse,
    s = evidence.stock;
  if (
    !w ||
    w.source_warehouse !== "default" ||
    w.target_location_id !== location.id ||
    !text(w.source_facility) ||
    w.scope !== "SINGLE_STORE" ||
    !text(w.confirmed_by) ||
    !date(w.confirmed_at) ||
    Date.parse(w.confirmed_at) > Date.parse(assessmentAt) ||
    !hash(w.evidence_sha256)
  )
    blockers.push("WAREHOUSE_MAPPING_UNCONFIRMED");
  if (w?.quantity_meaning !== "PHYSICAL_INCLUDES_RESERVED")
    blockers.push("PHYSICAL_STOCK_MEANING_UNCONFIRMED");
  if (
    !fresh(s.captured_at, assessmentAt, 24) ||
    !text(s.confirmed_by) ||
    !hash(s.evidence_sha256) ||
    s.includes_reservations !== true ||
    s.source_warehouse !== w?.source_warehouse ||
    s.source_facility !== w?.source_facility
  )
    blockers.push("STOCK_EVIDENCE_INCOMPLETE_OR_STALE");
  const rows = pilot.rows.map((p) => {
    const d = live.get(p.barcode),
      r = supplied.get(p.barcode),
      issues = [];
    if (!r || !quantity(r.physical_qty) || !quantity(r.reserved_qty))
      issues.push("EXPLICIT_WHOLE_QUANTITIES_REQUIRED");
    else if (Number(r.reserved_qty) > Number(r.physical_qty))
      issues.push("RESERVED_EXCEEDS_PHYSICAL");
    else if (Number(r.reserved_qty) > 0)
      issues.push("RESERVATION_MIGRATION_PLAN_REQUIRED");
    if (
      d.balance_present &&
      (Number(d.qty) !== 0 || Number(d.reserved_qty) !== 0)
    )
      issues.push("NONZERO_DESTINATION_REQUIRES_SEPARATE_DELTA_PLAN");
    return {
      barcode: p.barcode,
      variant_id: p.variant_id,
      product_id: p.product_id,
      product_name: p.product_name,
      attributes: p.attributes,
      price_cents: p.public_price_cents,
      cost_cents: null,
      target_location_id: location.id,
      balance_present: d.balance_present,
      expected_qty: d.qty,
      expected_reserved_qty: d.reserved_qty,
      historical_movements: d.movement_count,
      physical_qty: r?.physical_qty ?? null,
      reserved_qty: r?.reserved_qty ?? null,
      available_qty: issues.length
        ? null
        : String(Number(r.physical_qty) - Number(r.reserved_qty)),
      issues,
    };
  });
  const ready = blockers.length === 0 && rows.every((r) => !r.issues.length);
  const batch = digest({
    pilot: pilot.identity_sha256,
    location: location.id,
    evidence,
  });
  return {
    version: "m9-pilot-stock-plan-1",
    mode: "OFFLINE_READ_ONLY",
    project_id: PROJECT,
    assessment_at: assessmentAt,
    readiness: ready
      ? "EVIDENCE_COMPLETE_REHEARSAL_STILL_REQUIRED"
      : "BLOCKED_MISSING_OR_CHANGED_EVIDENCE",
    production_allowed: false,
    inventory_import_allowed: false,
    activation_allowed: false,
    woo_writes_allowed: false,
    reservations_migrated: false,
    baseline_is_not_a_source_quantity: true,
    source_quantities_copied: false,
    warehouse_location_confirmed: !blockers.includes(
      "WAREHOUSE_MAPPING_UNCONFIRMED",
    ),
    warehouse_confirmation: { ...w },
    location: { ...location },
    blockers,
    rows,
    evidence_template: template,
    evidence_sha256: digest(evidence),
    batch_reference: "M9-PILOT-STOCK-" + batch,
    identity_sha256: pilot.identity_sha256,
    summary: {
      codes: rows.length,
      rows_with_evidence_issues: rows.filter((r) => r.issues.length).length,
      existing_balance_rows: rows.filter((r) => r.balance_present).length,
      history_movements_preserved: rows.reduce(
        (a, r) => a + r.historical_movements,
        0,
      ),
    },
  };
}

// Read-only transaction: proves live baseline/scope still match. The result
// reports incomplete evidence as blocked; it never simulates invented stock.
export function pilotStockPreflightSQL(plan, snapshot) {
  if (
    plan.project_id !== PROJECT ||
    snapshot.project_id !== PROJECT ||
    plan.production_allowed !== false ||
    plan.inventory_import_allowed !== false ||
    plan.activation_allowed !== false ||
    !plan.rows?.length ||
    !snapshot.control?.enabled
  )
    throw Error("READ_ONLY_STAGING_PLAN_REQUIRED");
  if (
    plan.rows.length !== snapshot.rows?.length ||
    digest(plan.location) !==
      digest(
        snapshot.locations?.find((l) => l.id === snapshot.proposed_location_id),
      ) ||
    new Set(plan.rows.map((r) => r.barcode)).size !== plan.rows.length
  )
    throw Error("EXACT_PREFLIGHT_SCOPE_REQUIRED");
  const q = (s) => quoteDoText(s, "$stock$");
  const expected = plan.rows.map((r) => {
    const d = snapshot.rows.find((d) => d.barcode === r.barcode);
    if (!d || d.variant_id !== r.variant_id || d.product_id !== r.product_id)
      throw Error("PREFLIGHT_IDENTITY_CHANGED");
    return d;
  });
  const metadata = {
    mode: "READ_ONLY_ROLLBACK_PREFLIGHT",
    checked_codes: expected.length,
    readiness: plan.readiness,
    global_blockers: plan.blockers,
    rows_with_evidence_issues: plan.summary.rows_with_evidence_issues,
    stock_written: false,
    sales_activated: false,
    production_allowed: false,
  };
  return `begin isolation level repeatable read read only;\nset local standard_conforming_strings=on;\nset local statement_timeout='30s';\ndo $stock$\ndeclare d jsonb; v jsonb; b jsonb;\nbegin\n perform app.assert_sicar_staging_enabled();\n if not exists(select 1 from app.m9_rehearsal_control where singleton and enabled) then raise exception 'STOCK_GUARD_DISABLED';end if;\n if clock_timestamp()>${q(snapshot.captured_at)}::timestamptz+interval '1 hour' or clock_timestamp()<${q(snapshot.captured_at)}::timestamptz then raise exception 'STOCK_SNAPSHOT_STALE';end if;\n if (select to_jsonb(l) from (select id,name,type,is_active from public.locations where id=${q(plan.location.id)}::uuid) l) is distinct from ${q(JSON.stringify(plan.location))}::jsonb then raise exception 'STOCK_LOCATION_CHANGED';end if;\n for d in select value from jsonb_array_elements(${q(JSON.stringify(expected))}::jsonb) loop\n  select app.m9_rehearsal_current_row((d->>'variant_id')::uuid) into v;\n  if v is distinct from d->'current' or not exists(select 1 from public.variants x join public.products p on p.id=x.product_id join app.m9_rows r on r.variant_id=x.id join app.m9_rehearsal_allowlist a on a.variant_id=x.id where x.id=(d->>'variant_id')::uuid and x.product_id=(d->>'product_id')::uuid and x.is_active and p.is_active and p.measure_unit_code='PIECE' and r.source_row=v and a.expected_row=v) or not exists(select 1 from public.barcodes x where x.variant_id=(d->>'variant_id')::uuid and x.code=d->>'barcode' and x.source='SICAR') then raise exception 'STOCK_CATALOG_CHANGED';end if;\n  select jsonb_build_object('qty',qty::text,'reserved_qty',reserved_qty::text) into b from public.inventory_by_location where variant_id=(d->>'variant_id')::uuid and location_id=${q(plan.location.id)}::uuid;\n  if (b is not null) is distinct from (d->>'balance_present')::boolean or (b is not null and (b->>'qty' is distinct from d->>'qty' or b->>'reserved_qty' is distinct from d->>'reserved_qty')) or (select count(*) from public.inventory_movements where variant_id=(d->>'variant_id')::uuid)<>(d->>'movement_count')::bigint then raise exception 'STOCK_BASELINE_CHANGED';end if;\n end loop;\nend $stock$;\nselect ${q(JSON.stringify(metadata))}::jsonb as result;\nrollback;\n`;
}

export async function preparePilotStock(configPath, out) {
  const config = JSON.parse(await readFile(configPath)),
    base = dirname(resolve(configPath)),
    data = {},
    inputs = {};
  for (const key of ["renewal", "snapshot", "evidence"]) {
    const pin = config.inputs?.[key];
    if (key === "evidence" && !pin) {
      data[key] = null;
      continue;
    }
    if (!pin || !hash(pin.sha256)) throw Error("PINNED_INPUT_REQUIRED:" + key);
    const raw = await readFile(resolve(base, pin.path));
    if (sha(raw) !== pin.sha256) throw Error("INPUT_CHANGED:" + key);
    data[key] = JSON.parse(raw);
    inputs[key] = pin.sha256;
  }
  const plan = pilotStockPlan(
    data.renewal,
    data.snapshot,
    data.evidence,
    config.assessment_at,
  );
  plan.inputs = inputs;
  const files = {
    "plan.json": json(plan),
    "captura-pendiente.json": json(plan.evidence_template),
    "preflight-rollback.sql": pilotStockPreflightSQL(plan, data.snapshot),
    "reporte.html": `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Piloto: existencias pendientes</title><style>body{font:17px system-ui;max-width:1100px;margin:32px auto;padding:18px;color:#192c34;background:#f4f0e8}section{background:white;padding:20px;margin:16px 0;border-radius:12px}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #ccc}code{overflow-wrap:anywhere}@media print{body{background:white}} </style><h1>Preparación del piloto · ${plan.summary.codes} códigos</h1><p>No carga existencias ni habilita ventas. ${esc(plan.readiness)}.</p><section><h2>Almacén</h2><p>${plan.warehouse_location_confirmed ? "Confirmado: Default corresponde sólo a La Piedad." : "Equivalencia pendiente de confirmar."}</p><p>En SICAR: Configuraciones → Productos → Almacenes. Se observó Default en VSM, contexto VAQUERO SM / MARIANO JIMENEZ. Confirmar con quien controla inventario: ¿Default corresponde solamente a La Piedad o mezcla otras sucursales/bodegas? ¿La existencia mostrada es física total o ya descuenta apartados?</p><p>No cambiar nombres ni configuraciones. Si mezcla sucursales, necesitamos el desglose; no repartimos las piezas por suposición.</p></section><section><h2>Hoja de comprobación del piloto</h2><p>Confirmar cantidades físicas y apartadas al mismo corte, con responsable y evidencia. Un espacio vacío significa pendiente, no cero. Las cantidades del archivo no se copian aquí.</p><table><tr><th>Código / producto</th><th>Talla</th><th>Precio público</th><th>Físicas</th><th>Apartadas</th></tr>${plan.rows.map((r) => `<tr><td><code>${esc(r.barcode)}</code><br>${esc(r.product_name)}</td><td>${esc(Object.values(r.attributes ?? {}).join(" · "))}</td><td>$${(r.price_cents / 100).toFixed(2)}</td><td>________</td><td>________</td></tr>`).join("")}</table><p>Fecha y hora: __________________ Responsable: __________________ Evidencia: __________________</p></section><section><h2>Cómo se probará</h2><ol><li>Confirmar almacén, cantidades y reservas; revisar cambios del corte.</li><li>Ensayar la carga en staging con libro e idempotencia, y rollback. No inventar compromisos para reservas: si existen, preparar su migración aparte.</li><li>Desde el programa: lector → producto/talla/precio → venta → ticket → devolución → saldo y caja. Mantener los otros códigos bloqueados.</li><li>Repetir intento para verificar que no duplica movimientos. Retirar sólo piezas de ensayo que no tengan compromisos; conservar tickets e historial.</li></ol><p>Este bloque verifica el paso previo por sólo lectura. La carga y prueba operativa con saldos reales todavía no se ejecutaron. Costos desconocidos NULL; no escribe en Woo ni producción.</p></section></html>`,
  };
  await mkdir(out);
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(out, name), value, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(Object.entries(files).map(([n, v]) => [n, sha(v)])),
    ),
    { flag: "wx" },
  );
  return plan.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT_DIR");
  console.log(await preparePilotStock(...process.argv.slice(2)));
}
