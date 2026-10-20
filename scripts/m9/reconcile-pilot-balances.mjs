import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { digest } from "./acceleration.mjs";
import { reviewPilotEvidence } from "./review-sicar-pilot-evidence.mjs";
import { pilotLedgerTechnicalRehearsal } from "./pilot-ledger-technical-rehearsal.mjs";
import {
  pilotStockPlan,
  pilotStockPreflightSQL,
} from "./prepare-pilot-stock.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const json = (s) => JSON.stringify(s, null, 2) + "\n";
const literal = (s) => typeof s === "string" && !!s && s.trim() === s;
const whole = (s) => typeof s === "string" && /^(0|[1-9]\d{0,8})$/.test(s);
const fresh = (s, at, hours) =>
  Number.isFinite(Date.parse(s)) &&
  Date.parse(s) <= Date.parse(at) &&
  Date.parse(at) - Date.parse(s) <= hours * 3600000;
const key = (d) => d.client_ref + "|" + d.folio;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Read-only draft. Credit facts never become stock/reservation approval.
export function reconcilePilotBalances(data, assessmentAt) {
  const {
    renewal,
    observations,
    accounts,
    documents,
    scope,
    movements,
    snapshot,
    evidence,
  } = data;
  const base = pilotStockPlan(renewal, snapshot, evidence, assessmentAt);
  if (
    !Array.isArray(observations) ||
    observations.some((o) => !fresh(o.captured_at, assessmentAt, 24))
  )
    throw Error("FRESH_SOURCE_STOCK_REQUIRED");
  if (
    scope.search !== "APARTADO" ||
    scope.receipt_filter !== "Todos" ||
    scope.not_a_physical_reservation_report !== true ||
    scope.delivery_field_observed !== false ||
    scope.unlabelled_customers_reviewed !== false ||
    scope.terminal_page_observed !== true ||
    !fresh(scope.captured_at, assessmentAt, 24)
  )
    throw Error("BOUNDED_CREDIT_SCOPE_REQUIRED");
  if (
    !Array.isArray(accounts) ||
    accounts.length !== scope.terminal_list_count ||
    !accounts.length ||
    new Set(accounts.map((c) => c.client_ref)).size !== accounts.length ||
    new Set(accounts.map((c) => c.list_index)).size !== accounts.length ||
    accounts.some(
      (c) =>
        !literal(c.client_ref) ||
        !Number.isSafeInteger(c.list_index) ||
        c.list_index < 0 ||
        c.list_index >= accounts.length,
    )
  )
    throw Error("COMPLETE_ACCOUNT_SCOPE_REQUIRED");
  const expected = new Map();
  for (const c of accounts)
    for (const [name, status] of [
      ["unpaid", "OPEN"],
      ["paid", "PAID"],
    ]) {
      const r = c[name];
      if (
        !r ||
        !Array.isArray(r.folios) ||
        new Set(r.folios).size !== r.folios.length ||
        r.folios.some((f) => !literal(f) || !/^[A-Z0-9-]+$/.test(f)) ||
        r.no_documents !== (r.folios.length === 0) ||
        (!r.folios.length && !literal(r.empty_marker)) ||
        !fresh(r.captured_at, assessmentAt, 24)
      )
        throw Error("BOTH_FINANCIAL_STATES_REQUIRED");
      for (const folio of r.folios) {
        const k = key({ client_ref: c.client_ref, folio });
        if (expected.has(k)) throw Error("CONFLICTING_CREDIT_STATE");
        expected.set(k, { status, list_index: c.list_index });
      }
    }
  const seen = new Set(),
    lines = [];
  for (const d of documents) {
    const k = key(d),
      e = expected.get(k);
    if (
      !e ||
      seen.has(k) ||
      d.financial_status !== e.status ||
      d.list_index !== e.list_index ||
      d.warehouse !== "DEFAULT" ||
      d.delivery_status !== "UNKNOWN" ||
      !fresh(d.captured_at, assessmentAt, 24) ||
      !d.lines?.length ||
      new Set(d.lines.map((l) => l.line_index)).size !== d.lines.length ||
      d.lines.some(
        (l, i) =>
          l.line_index !== i ||
          !literal(l.barcode) ||
          !literal(l.description) ||
          !whole(l.quantity) ||
          Number(l.quantity) <= 0,
      )
    )
      throw Error("EXACT_CREDIT_DOCUMENT_DETAIL_REQUIRED");
    seen.add(k);
    for (const l of d.lines)
      lines.push({
        ...l,
        client_ref: d.client_ref,
        folio: d.folio,
        financial_status: d.financial_status,
        delivery_status: "UNKNOWN",
        inventory_effect: "UNVERIFIED",
        additional_stock_deduction: null,
        financial_import_allowed: false,
      });
  }
  if (seen.size !== expected.size) throw Error("CREDIT_DOCUMENT_MISSING");
  const movementKeys = new Set();
  for (const m of movements) {
    const candidates = lines.filter(
      (l) => l.folio === m.folio && l.barcode === m.barcode,
    );
    const mk = m.folio + "|" + m.barcode;
    const cells = String(m.table ?? "")
        .split(/[\n\t]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      at = cells.indexOf("Venta " + m.folio);
    if (
      movementKeys.has(mk) ||
      candidates.length !== 1 ||
      m.movement !== "Venta" ||
      m.warehouse !== "Default" ||
      m.quantity !== candidates[0].quantity ||
      !whole(m.balance_after) ||
      !fresh(m.captured_at, assessmentAt, 24) ||
      !m.detail?.includes(`- button "${m.barcode}":`) ||
      !m.table?.includes("Venta " + m.folio) ||
      !m.table.includes("Default") ||
      at < 0 ||
      cells[at + 1] !== "Default" ||
      cells[at + 3] !== m.quantity ||
      cells[at + 4] !== m.balance_after
    )
      throw Error("EXACT_SALE_MOVEMENT_REQUIRED");
    movementKeys.add(mk);
    candidates[0].inventory_effect = "SALE_DEBIT_OBSERVED";
    candidates[0].additional_stock_deduction = "0";
  }
  const openClients = accounts.map((c) => ({
    client_ref: c.client_ref,
    list_index: c.list_index,
    filter: "No pagado / recepción Todos",
    ...c.unpaid,
  }));
  const reviewed = reviewPilotEvidence(
    renewal,
    observations,
    openClients,
    documents.filter((d) => d.financial_status === "OPEN"),
    { ...scope, filter: "No pagado / recepción Todos" },
  );
  if (reviewed.identity_sha256 !== base.identity_sha256)
    throw Error("PILOT_SCOPE_CHANGED");
  const blockers = [
    ...new Set([
      ...base.blockers,
      "PHYSICAL_DELIVERY_AND_UNLABELLED_COMMITMENTS_NOT_VERIFIED",
    ]),
  ];
  const rows = base.rows.map((r) => {
    const o = reviewed.rows.find((o) => o.barcode === r.barcode),
      matches = lines.filter((l) => l.barcode === r.barcode);
    const baseline = r.balance_present ? Number(r.expected_qty) : 0;
    return {
      ...r,
      source_balance_observed: o.observed_source_qty,
      source_observed_at: o.observed_at,
      source_observation_sha256: o.observation_sha256,
      source_balance_is_not_physical_count: true,
      comparison_delta: String(Number(o.observed_source_qty) - baseline),
      comparison_delta_is_not_an_import: true,
      credit_matches: matches,
      paid_credit_units: String(
        matches
          .filter((l) => l.financial_status === "PAID")
          .reduce((n, l) => n + Number(l.quantity), 0),
      ),
      open_credit_units: String(
        matches
          .filter((l) => l.financial_status === "OPEN")
          .reduce((n, l) => n + Number(l.quantity), 0),
      ),
      physical_qty: null,
      reserved_qty: null,
      available_qty: null,
      import_qty: null,
      import_allowed: false,
      issues: [
        ...r.issues,
        ...(matches.length ? ["MATCHED_CREDIT_DELIVERY_UNVERIFIED"] : []),
      ],
    };
  });
  const candidate = rows.filter((r) => !r.credit_matches.length);
  const confirmedBase = {
    ...base,
    readiness: "BLOCKED_MISSING_OR_CHANGED_EVIDENCE",
    blockers,
    rows,
  };
  return {
    version: "m9-pilot-credit-stock-reconciliation-1",
    mode: "OFFLINE_READ_ONLY",
    project_id: base.project_id,
    assessment_at: assessmentAt,
    identity_sha256: base.identity_sha256,
    production_allowed: false,
    inventory_import_allowed: false,
    activation_allowed: false,
    financial_import_allowed: false,
    woo_writes_allowed: false,
    readiness: confirmedBase.readiness,
    blockers,
    scope: { ...scope, sequential_capture_not_atomic: true },
    rows,
    credit_lines: lines,
    stock_plan: confirmedBase,
    source_stock_review: reviewed,
    summary: {
      codes: rows.length,
      observed_units: rows.reduce(
        (n, r) => n + Number(r.source_balance_observed),
        0,
      ),
      accounts: accounts.length,
      open_documents: documents.filter((d) => d.financial_status === "OPEN")
        .length,
      paid_documents: documents.filter((d) => d.financial_status === "PAID")
        .length,
      credit_lines: lines.length,
      verified_sale_debit_lines: lines.filter(
        (l) => l.inventory_effect === "SALE_DEBIT_OBSERVED",
      ).length,
      codes_with_credit_matches: rows.filter((r) => r.credit_matches.length)
        .length,
      no_credit_match_candidates: candidate.length,
      candidate_observed_units: candidate.reduce(
        (n, r) => n + Number(r.source_balance_observed),
        0,
      ),
      no_match_is_not_zero_reservations: true,
    },
    review_questions: rows
      .filter((r) => r.credit_matches.length)
      .map((r) => ({
        id:
          "delivery-" +
          digest({ identity: base.identity_sha256, barcode: r.barcode }).slice(
            0,
            16,
          ),
        barcode: r.barcode,
        product_name: r.product_name,
        question: `Este producto aparece en un crédito ya registrado. ¿La pieza se entregó al cliente o todavía está guardada para entregarla?`,
        options: [
          "Ya se entregó",
          "Sigue guardada para entregar",
          "No se puede identificar todavía",
        ],
        answer: null,
      })),
    next_batch_candidates: candidate.map((r) => r.barcode),
    next_batch_is_not_authorized: true,
  };
}

// Derive QA scope from full credit evidence, never an editable approval list.
export function pilotBalanceLedgerRehearsal(
  data,
  assessmentAt,
  observationsRaw,
) {
  if (digest(JSON.parse(observationsRaw)) !== digest(data.observations))
    throw Error("PARENT_SOURCE_OBSERVATIONS_CHANGED");
  const plan = reconcilePilotBalances(data, assessmentAt),
    selected = new Set(plan.next_batch_candidates);
  if (!selected.size) throw Error("NO_CREDIT_FREE_QA_ROWS");
  const rows = plan.source_stock_review.rows.filter((r) =>
      selected.has(r.barcode),
    ),
    observations = data.observations.filter((o) => selected.has(o.barcode)),
    raw = json(observations);
  const review = {
    ...plan.source_stock_review,
    rows,
    identity_sha256: digest(
      rows.map(({ barcode, variant_id, product_id }) => ({
        barcode,
        variant_id,
        product_id,
      })),
    ),
    inputs: { observations: sha(raw) },
  };
  const snapshot = {
    ...data.snapshot,
    rows: data.snapshot.rows.filter((r) => selected.has(r.barcode)),
  };
  return (
    `-- Derived QA scope only; credit-match codes held outside this rehearsal.\n-- Parent observation SHA256: ${sha(observationsRaw)}\n` +
    pilotLedgerTechnicalRehearsal(review, snapshot, raw)
  );
}

export async function preparePilotBalanceReconciliation(configPath, out) {
  const path = resolve(configPath),
    config = JSON.parse(await readFile(path)),
    data = {},
    inputs = {},
    rawInputs = {};
  for (const name of [
    "renewal",
    "observations",
    "accounts",
    "documents",
    "scope",
    "movements",
    "snapshot",
    "evidence",
  ]) {
    const pin = config.inputs?.[name];
    if (
      !pin ||
      typeof pin.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(pin.sha256 ?? "")
    )
      throw Error("PINNED_BALANCE_INPUT_REQUIRED:" + name);
    const raw = await readFile(resolve(dirname(path), pin.path));
    if (sha(raw) !== pin.sha256) throw Error("BALANCE_INPUT_CHANGED:" + name);
    data[name] = JSON.parse(raw);
    inputs[name] = pin.sha256;
    rawInputs[name] = raw.toString("utf8");
  }
  const plan = reconcilePilotBalances(data, config.assessment_at);
  plan.inputs = inputs;
  const files = {
    "plan.json": json(plan),
    "preflight-rollback.sql": pilotStockPreflightSQL(
      plan.stock_plan,
      data.snapshot,
    ),
    "preguntas.json": json(plan.review_questions),
    "captura-pendiente.json": json({
      ...(data.evidence ?? plan.stock_plan.evidence_template),
      stock: {
        ...(data.evidence ?? plan.stock_plan.evidence_template).stock,
        rows: plan.rows.map((r) => ({
          barcode: r.barcode,
          physical_qty: null,
          reserved_qty: null,
        })),
      },
    }),
    "reporte.html": `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M9: conciliación de saldos</title><style>body{font:17px/1.5 system-ui;max-width:1150px;margin:32px auto;padding:20px;background:#f5f2e9;color:#182f3a}section{background:white;padding:22px;margin:20px 0;border-radius:12px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:10px;text-align:left;border-bottom:1px solid #ddd}.hold{color:#9a4f14}code{overflow-wrap:anywhere}</style><h1>Piloto: saldos y compromisos separados</h1><p>Sólo lectura. No carga existencias, deudas ni reservas y no activa ventas.</p><section><h2>${plan.summary.accounts} cuentas · ${plan.summary.paid_documents} documentos pagados · ${plan.summary.open_documents} pendientes</h2><p>${plan.summary.credit_lines} líneas revisadas por código exacto. Recepción de pago y abonos no prueban entrega de mercancía. No descontar otra vez una salida ya registrada.</p></section><section><h2>${plan.summary.codes} códigos · ${plan.summary.observed_units} piezas mostradas en SICAR</h2><div class="scroll"><table><tr><th>Código / producto</th><th>SICAR observado</th><th>Destino registrado</th><th>Diferencia comparativa</th><th>Coincidencias en créditos</th><th>Cantidad importable</th></tr>${plan.rows.map((r) => `<tr><td><code>${esc(r.barcode)}</code><br>${esc(r.product_name)}</td><td>${esc(r.source_balance_observed)}</td><td>${r.balance_present ? esc(r.expected_qty) : "Sin fila de saldo"}</td><td>${esc(r.comparison_delta)}</td><td class="hold">${r.credit_matches.length ? r.credit_matches.length + "; entrega sin verificar" : "Sin coincidencia en este alcance"}</td><td>Pendiente</td></tr>`).join("")}</table></div><p>Las diferencias son referencias de comparación; no son una orden de carga ni un conteo físico. Reservas y disponibilidad sin confirmar permanecen sin definir.</p></section><section><h2>Siguiente lote candidato</h2><p>${plan.summary.no_credit_match_candidates} códigos sin coincidencia en los créditos del alcance, con ${plan.summary.candidate_observed_units} piezas observadas. Mantienen los bloqueos generales; esta selección no autoriza carga ni reservas cero. Los códigos con coincidencia se revisan por separado.</p></section><section><h2>Consulta concreta de entrega</h2>${plan.review_questions.map((q) => `<p><strong>${esc(q.product_name)} · ${esc(q.barcode)}</strong><br>${esc(q.question)}</p><ul>${q.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`).join("")}<p>Pregunta preparada; no se publicó en main ni se respondió automáticamente.</p></section><section><h2>Antes de operar</h2><p>Conciliar el significado del saldo y las entregas/compromisos restantes; completar el corte con responsable y evidencia. Default → La Piedad ya está confirmado. Después, preparar la carga específica y su reversión, y aceptar el piloto desde Preview con acceso y PIN reales. Los ensayos anteriores ya verificaron el libro y el flujo de venta/devolución.</p></section>`,
  };
  if (plan.next_batch_candidates.length)
    files["ensayo-libro-rollback.sql"] = pilotBalanceLedgerRehearsal(
      data,
      config.assessment_at,
      rawInputs.observations,
    );
  await mkdir(out);
  for (const [name, content] of Object.entries(files))
    await writeFile(resolve(out, name), content, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(Object.entries(files).map(([n, c]) => [n, sha(c)])),
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
  console.log(
    await preparePilotBalanceReconciliation(...process.argv.slice(2)),
  );
}
