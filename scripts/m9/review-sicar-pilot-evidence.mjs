import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { digest } from "./acceleration.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const json = (s) => JSON.stringify(s, null, 2) + "\n";
const literal = (s) => typeof s === "string" && s.length > 0 && s === s.trim();
const whole = (s) => typeof s === "string" && /^(0|[1-9]\d{0,8})$/.test(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Source observation and exact credit-document crosscheck. A financial balance
// or an empty search never establishes physical stock/reservations, even when
// all clients in the named search have been inspected.
export function reviewPilotEvidence(
  renewal,
  observations,
  clients,
  documents,
  scope,
) {
  const pilot = renewal.pilot;
  if (
    renewal.version !== "m9-renewed-pilot-1" ||
    renewal.project_id !== "zsezjtswqeijboezvado" ||
    renewal.production_allowed !== false ||
    renewal.inventory_import_allowed !== false ||
    !pilot?.rows?.length ||
    pilot.identity_sha256 !==
      digest(
        pilot.rows.map(({ barcode, variant_id, product_id }) => ({
          barcode,
          variant_id,
          product_id,
        })),
      )
  )
    throw Error("RENEWED_READ_ONLY_PILOT_REQUIRED");
  const byCode = new Map(),
    byClient = new Map(),
    byFolio = new Map();
  for (const o of observations) {
    if (!literal(o.barcode) || byCode.has(o.barcode))
      throw Error("DUPLICATE_OR_NONLITERAL_OBSERVATION");
    byCode.set(o.barcode, o);
  }
  if (byCode.size !== pilot.rows.length)
    throw Error("EXACT_OBSERVATION_SCOPE_REQUIRED");
  for (const c of clients) {
    if (
      !literal(c.client_ref) ||
      byClient.has(c.client_ref) ||
      !Number.isSafeInteger(c.list_index) ||
      c.list_index < 0 ||
      !Array.isArray(c.folios) ||
      c.filter !== "No pagado / recepción Todos" ||
      c.no_documents !== (c.folios.length === 0)
    )
      throw Error("INCOMPLETE_OR_DUPLICATE_CLIENT_REVIEW");
    byClient.set(c.client_ref, c);
  }
  if (
    scope.search !== "APARTADO" ||
    scope.filter !== "No pagado / recepción Todos" ||
    scope.terminal_list_count !== byClient.size ||
    !scope.terminal_page_observed ||
    new Set(clients.map((c) => c.list_index)).size !== byClient.size ||
    clients.some((c) => c.list_index >= byClient.size)
  )
    throw Error("EXACT_SCOPED_CLIENT_COVERAGE_REQUIRED");
  for (const d of documents) {
    const c = byClient.get(d.client_ref);
    if (
      !literal(d.folio) ||
      byFolio.has(d.folio) ||
      !c?.folios.includes(d.folio) ||
      d.warehouse !== "DEFAULT" ||
      !d.lines?.length ||
      d.lines.some(
        (l) =>
          !literal(l.barcode) ||
          !whole(l.quantity) ||
          Number(l.quantity) === 0 ||
          !literal(l.description),
      )
    )
      throw Error("DOCUMENT_DETAIL_REQUIRED");
    byFolio.set(d.folio, d);
  }
  if (
    clients.some((c) => c.folios.some((f) => !byFolio.has(f))) ||
    clients.some((c) => new Set(c.folios).size !== c.folios.length)
  )
    throw Error("PENDING_DOCUMENT_NOT_REVIEWED");
  const rows = pilot.rows.map((p) => {
    const o = byCode.get(p.barcode),
      m = o?.observed_label?.match(/^ALMACENES\s+(\d+) PZA$/);
    if (
      !m ||
      !whole(m[1]) ||
      !o.detail?.includes(`- button "${p.barcode}":`) ||
      !o.detail.includes(`- paragraph: ${p.source_description}\n`) ||
      (o.detail.match(/- paragraph: Default\n/g) ?? []).length !== 1 ||
      !o.detail.includes(`- button "Almacenes ${m[1]} PZA":`) ||
      !Number.isFinite(Date.parse(o.captured_at))
    )
      throw Error("SOURCE_DETAIL_SCOPE_OR_IDENTITY_CHANGED");
    const price = (p.public_price_cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (!o.detail.includes(`- paragraph: $${price} MXN\n`))
      throw Error("SOURCE_PRICE_CHANGED");
    const matches = documents.flatMap((d) =>
      d.lines
        .filter((l) => l.barcode === p.barcode)
        .map((l) => ({
          folio: d.folio,
          quantity: l.quantity,
          description: l.description,
        })),
    );
    return {
      barcode: p.barcode,
      variant_id: p.variant_id,
      product_id: p.product_id,
      product_name: p.product_name,
      attributes: p.attributes,
      price_cents: p.public_price_cents,
      cost_cents: null,
      observed_source_qty: m[1],
      source_warehouse: "default",
      observed_at: o.captured_at,
      observation_sha256: digest(o),
      same_as_received_export: p.source_stock_observed === m[1],
      pending_credit_matches: matches,
      matched_credit_quantity: String(
        matches.reduce((n, r) => n + Number(r.quantity), 0),
      ),
      physical_qty: null,
      reserved_qty: null,
      available_qty: null,
      import_allowed: false,
    };
  });
  return {
    version: "m9-sicar-pilot-evidence-1",
    mode: "OFFLINE_READ_ONLY",
    production_allowed: false,
    inventory_import_allowed: false,
    activation_allowed: false,
    identity_sha256: pilot.identity_sha256,
    source_observation_is_not_physical_count: true,
    credit_documents_are_not_reservation_records: true,
    scope: {
      ...scope,
      unlabelled_clients_reviewed: false,
      paid_documents_reviewed: false,
      physical_delivery_verified: false,
    },
    summary: {
      codes: rows.length,
      source_units_observed: rows.reduce(
        (n, r) => n + Number(r.observed_source_qty),
        0,
      ),
      clients_reviewed: byClient.size,
      pending_credit_documents: byFolio.size,
      document_lines: documents.reduce((n, d) => n + d.lines.length, 0),
      pilot_codes_with_credit_matches: rows.filter(
        (r) => r.pending_credit_matches.length,
      ).length,
      changed_since_export: rows.filter((r) => !r.same_as_received_export)
        .length,
    },
    rows,
    blockers: [
      "CREDIT_SALE_STOCK_EFFECT_REQUIRES_EVIDENCE",
      "PHYSICAL_DELIVERY_AND_OTHER_COMMITMENTS_NOT_VERIFIED",
    ],
    no_match_does_not_authorize_zero_reservations: true,
  };
}

export async function prepareSicarPilotEvidence(configPath, out) {
  const config = JSON.parse(await readFile(configPath)),
    base = dirname(resolve(configPath)),
    data = {},
    inputs = {};
  for (const key of [
    "renewal",
    "observations",
    "clients",
    "documents",
    "scope",
  ]) {
    const pin = config.inputs?.[key];
    if (!/^[a-f0-9]{64}$/.test(pin?.sha256 ?? ""))
      throw Error("PINNED_INPUT_REQUIRED:" + key);
    const raw = await readFile(resolve(base, pin.path));
    if (sha(raw) !== pin.sha256) throw Error("INPUT_CHANGED:" + key);
    data[key] = JSON.parse(raw);
    inputs[key] = pin.sha256;
  }
  const r = reviewPilotEvidence(
    data.renewal,
    data.observations,
    data.clients,
    data.documents,
    data.scope,
  );
  r.inputs = inputs;
  const files = {
    "revision.json": json(r),
    "reporte.html": `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Piloto: consulta SICAR</title><style>body{font:17px system-ui;max-width:1100px;margin:30px auto;padding:18px;background:#f4f0e8;color:#192c34}section{background:white;padding:20px;border-radius:12px;margin:16px 0}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ccc}code{overflow-wrap:anywhere}</style><h1>Piloto · Verificación de SICAR</h1><p>Sólo lectura. No se cargaron saldos ni se activaron ventas.</p><section><h2>${r.summary.codes} códigos · ${r.summary.source_units_observed} piezas de existencia mostrada</h2><table><tr><th>Código / producto</th><th>Talla</th><th>Existencia en Default</th><th>Líneas en créditos revisados</th></tr>${r.rows.map((p) => `<tr><td><code>${esc(p.barcode)}</code><br>${esc(p.product_name)}</td><td>${esc(Object.values(p.attributes ?? {}).join(" · "))}</td><td>${esc(p.observed_source_qty)}</td><td>${p.pending_credit_matches.length}</td></tr>`).join("")}</table></section><section><h2>Apartados en Clientes → Crédito</h2><p>Se revisaron ${r.summary.clients_reviewed} cuentas obtenidas al buscar APARTADO, con filtro No pagado y recepción Todos: ${r.summary.pending_credit_documents} documentos y ${r.summary.document_lines} líneas. ${r.summary.pilot_codes_with_credit_matches} códigos del piloto coinciden literalmente con esas líneas.</p><p>No es una revisión de clientes sin esa etiqueta, documentos pagados o entrega física. No encontrar coincidencia no prueba que no exista mercancía apartada; no se convierte en cero.</p></section><section><h2>Antes de cargar</h2><p>Comprobar el efecto de la venta a crédito en el historial de inventario y el tratamiento de entregas pendientes. No descontar el mismo apartado dos veces. Las cantidades físicas, reservadas y disponibles permanecen sin definir.</p></section></html>`,
  };
  await mkdir(out);
  for (const [n, v] of Object.entries(files))
    await writeFile(resolve(out, n), v, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(Object.entries(files).map(([n, v]) => [n, sha(v)])),
    ),
    { flag: "wx" },
  );
  return r.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT_DIR");
  console.log(await prepareSicarPilotEvidence(...process.argv.slice(2)));
}
