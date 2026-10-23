import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./acceleration.mjs";

export const STAGE = "zsezjtswqeijboezvado";
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const need = (ok, reason) => {
  if (!ok) throw Error(reason);
};
export const byteHash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const controls = (s) =>
  Array.from(s).some(
    (c) =>
      c.codePointAt(0) < 32 ||
      (c.codePointAt(0) >= 127 && c.codePointAt(0) <= 159),
  );
const literal = (x) =>
  typeof x === "string" &&
  x.length > 0 &&
  x.length <= 80 &&
  x === x.trim() &&
  !controls(x);
export function utc(x) {
  need(
    typeof x === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
      Number.isFinite(Date.parse(x)) &&
      new Date(x).toISOString() === x,
    "CANONICAL_UTC_REQUIRED",
  );
  return Date.parse(x);
}
const quantity = (x) => {
  need(
    typeof x === "string" && /^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(x),
    "QUANTITY_INVALID",
  );
  return (
    BigInt(x.split(".")[0]) * 1000000n +
    BigInt((x.split(".")[1] ?? "").padEnd(6, "0"))
  );
};
export function deliveryPacket(archive, account, doc) {
  need(
    SHA.test(archive.source_plan_sha256) &&
      SHA.test(doc.key) &&
      SHA.test(account.key) &&
      doc.lines.length > 0,
    "ARCHIVE_DOCUMENT_INVALID",
  );
  const indices = new Set();
  for (const l of doc.lines) {
    need(
      Number.isSafeInteger(l.index) && l.index >= 0 && !indices.has(l.index),
      "LINE_INDEX_DUPLICATE_OR_INVALID",
    );
    indices.add(l.index);
    need(literal(l.barcode), "LITERAL_BARCODE_REQUIRED");
    need(quantity(l.quantity) > 0n, "QUANTITY_INVALID");
    need(
      l.delivery_status === "UNKNOWN" &&
        l.reserved_qty === null &&
        l.stock_deduction === null,
      "ARCHIVE_PHYSICAL_EFFECT_FORBIDDEN",
    );
  }
  return {
    archive_sha256: archive.source_plan_sha256,
    customer_key: account.key,
    document_key: doc.key,
    source_folio: doc.folio,
    source_document_id: doc.source_id,
    source_at: doc.source_at,
    // Entire source document includes money and cancelled payments. A change to
    // either invalidates a response; money never supplies a delivery decision.
    document_sha256: digest({
      archive_sha256: archive.source_plan_sha256,
      customer_key: account.key,
      client_ref: account.ref,
      document: doc,
    }),
    lines: doc.lines
      .map((l) => ({
        index: l.index,
        barcode: l.barcode,
        quantity: l.quantity,
        description: l.description,
        variant_id: l.variant_id,
        generic_debt: l.barcode === "SX00000",
      }))
      .sort((a, b) => a.index - b.index),
    question: "¿Qué mercancía de este documento ya se entregó?",
    choices: ["ALL_DELIVERED", "ALL_PENDING", "MIXED", "UNKNOWN"],
    statement: "UNKNOWN",
    operational_import_allowed: false,
    stock_delivery_allowed: false,
  };
}
export function classifyPendingLine({
  line,
  document_key,
  sourceRows,
  snapshot,
  assessed_at,
  catalogPlan,
}) {
  const out = {
    document_key,
    line_index: line.index,
    barcode: line.barcode,
    quantity: line.quantity,
    source_line_sha256: digest(line),
    variant_id: null,
    binding_allowed: false,
    stock_delivery_allowed: false,
  };
  if (!literal(line.barcode))
    return { ...out, reason: "LITERAL_BARCODE_INVALID_RETAINED" };
  if (line.barcode === "SX00000")
    return {
      ...out,
      reason: "GENERIC_DEBT_NOT_VARIANT",
      physical_quantity: null,
    };
  const sources = sourceRows.filter((r) => r.barcode === line.barcode);
  if (sources.length !== 1)
    return {
      ...out,
      reason: sources.length
        ? "SOURCE_BARCODE_DUPLICATE"
        : "SOURCE_BARCODE_ABSENT",
    };
  const src = sources[0];
  if (src.fields?.["clave1 *"] !== src.barcode)
    return { ...out, reason: "SOURCE_LITERAL_PROVENANCE_DIFFERS" };
  out.source = {
    row: src.row,
    row_sha256: digest(src),
    barcode: src.barcode,
    classification: src.classification,
  };
  const live = snapshot.codes.filter((c) => c.barcode === line.barcode);
  need(
    live.length === 1 &&
      Array.isArray(live[0].matches) &&
      Array.isArray(live[0].managed_rows),
    "EXACT_SNAPSHOT_INCOMPLETE",
  );
  const c = live[0];
  if (c.matches.length === 0 && c.managed_rows.length === 0) {
    const held =
      catalogPlan?.held?.filter((r) => r.barcode === line.barcode) ?? [];
    if (held.length)
      return {
        ...out,
        reason: "SOURCE_EXACT_CATALOG_IMPORT_HELD",
        catalog_holds: held.flatMap((r) => r.reasons),
      };
    return { ...out, reason: "SOURCE_EXACT_AWAITING_CATALOG_IMPORT" };
  }
  if (c.matches.length !== 1 || c.managed_rows.length !== 1)
    return { ...out, reason: "DESTINATION_BARCODE_AMBIGUOUS" };
  const m = c.matches[0],
    r = c.managed_rows[0];
  if (
    !UUID.test(m.variant_id ?? "") ||
    m.barcode_source !== "SICAR" ||
    m.primary !== true ||
    m.active !== true ||
    m.managed_barcode !== line.barcode ||
    m.managed_variant_id !== m.variant_id ||
    r.variant_id !== m.variant_id ||
    r.barcode !== line.barcode ||
    m.source_row?.barcode !== line.barcode ||
    digest(r.source_row) !== digest(m.source_row)
  )
    return { ...out, reason: "DESTINATION_LITERAL_PROVENANCE_DIFFERS" };
  if (
    utc(assessed_at) < utc(snapshot.captured_at) ||
    utc(assessed_at) - utc(snapshot.captured_at) > 86400000
  )
    return { ...out, reason: "DESTINATION_SNAPSHOT_STALE" };
  if (!m.current_row || digest(m.current_row) !== digest(m.source_row))
    return { ...out, reason: "CURRENT_MANAGED_ROW_REVIEW_REQUIRED" };
  // This is a candidate for a separately reviewed overlay; it never edits the
  // immutable archive/registered line and never authorizes a physical effect.
  return {
    ...out,
    proposed_variant_id: m.variant_id,
    reason: "EXACT_LITERAL_BINDING_PLAN_CANDIDATE",
    expected_destination_sha256: digest(m),
    requires_authenticated_review: true,
  };
}
export function prepareLinesDelivery({
  archive,
  sourceRows,
  snapshot,
  assessed_at,
  catalogPlan,
}) {
  utc(assessed_at);
  utc(archive.source_from);
  utc(archive.source_until);
  utc(snapshot.captured_at);
  need(
    archive.protocol === "m9-credit-detail-archive-1" &&
      archive.operational_import_allowed === false &&
      snapshot.project_id === STAGE &&
      snapshot.protocol === "m9-exact-legacy-lines-snapshot-1" &&
      snapshot.archive_sha256 === archive.source_plan_sha256,
    "PINNED_STAGING_ARCHIVE_REQUIRED",
  );
  const packets = [],
    pending = [],
    accounts = new Set(),
    documents = new Set();
  if (catalogPlan)
    need(
      catalogPlan.version === "m9-provisional-plan-1" &&
        catalogPlan.production_allowed === false &&
        catalogPlan.inventory_operations === 0 &&
        catalogPlan.write_allowed === false,
      "INERT_CATALOG_PLAN_REQUIRED",
    );
  for (const a of archive.accounts) {
    need(
      a.key === digest({ tenant: "VSM", client_ref: a.ref }) &&
        !accounts.has(a.key),
      "ACCOUNT_IDENTITY_INVALID",
    );
    accounts.add(a.key);
    for (const d of a.documents) {
      need(
        d.key ===
          digest({ tenant: "VSM", client_ref: a.ref, folio: d.folio }) &&
          !documents.has(d.key),
        "DOCUMENT_IDENTITY_INVALID",
      );
      documents.add(d.key);
      packets.push(deliveryPacket(archive, a, d));
      for (const l of d.lines)
        if (l.variant_id === null)
          pending.push(
            classifyPendingLine({
              line: l,
              document_key: d.key,
              sourceRows,
              snapshot,
              assessed_at,
              catalogPlan,
            }),
          );
    }
  }
  packets.sort((a, b) => a.document_key.localeCompare(b.document_key));
  pending.sort(
    (a, b) =>
      a.document_key.localeCompare(b.document_key) ||
      a.line_index - b.line_index,
  );
  const reasons = {};
  for (const l of pending) reasons[l.reason] = (reasons[l.reason] ?? 0) + 1;
  return {
    protocol: "m9-clientes-lines-delivery-plan-1",
    project_id: STAGE,
    archive_sha256: archive.source_plan_sha256,
    assessed_at,
    source_from: archive.source_from,
    source_until: archive.source_until,
    baseline_refreshed: false,
    operational_import_allowed: false,
    stock_delivery_allowed: false,
    binding_apply_allowed: false,
    summary: {
      accounts: accounts.size,
      documents: packets.length,
      lines: packets.reduce((n, p) => n + p.lines.length, 0),
      pending_lines: pending.length,
      plan_candidates: pending.filter(
        (l) => l.reason === "EXACT_LITERAL_BINDING_PLAN_CANDIDATE",
      ).length,
      reasons,
      delivery_questions: packets.length,
      unknown_documents: packets.length,
    },
    pending,
    packets,
  };
}
export function validateDeliveryObservation(packet, observation, assessed_at) {
  utc(assessed_at);
  utc(observation.reviewed_at);
  need(
    utc(observation.reviewed_at) >= utc(packet.source_at) &&
      utc(observation.reviewed_at) <= utc(assessed_at),
    "REVIEW_DATE_OUTSIDE_SOURCE_WINDOW",
  );
  need(
    observation.archive_sha256 === packet.archive_sha256 &&
      observation.document_key === packet.document_key &&
      observation.document_sha256 === packet.document_sha256,
    "DOCUMENT_REVISION_CHANGED",
  );
  need(
    SHA.test(observation.evidence_sha256 ?? "") &&
      typeof observation.reviewer_ref === "string" &&
      observation.reviewer_ref.length > 0 &&
      observation.reviewer_ref.length <= 160 &&
      !controls(observation.reviewer_ref),
    "REVIEW_EVIDENCE_REQUIRED",
  );
  need(
    ["UNKNOWN", "ALL_PENDING", "ALL_DELIVERED", "MIXED"].includes(
      observation.statement,
    ) && Array.isArray(observation.lines),
    "STATEMENT_INVALID",
  );
  need(
    observation.documentary_only === true &&
      observation.operational_import_allowed === false &&
      observation.stock_delivery_allowed === false,
    "OPERATIONAL_EFFECT_FORBIDDEN",
  );
  if (observation.statement === "MIXED") {
    need(
      observation.lines.length === packet.lines.length,
      "MIXED_COVERAGE_INCOMPLETE",
    );
    const seen = new Set();
    for (const l of observation.lines) {
      const src = packet.lines.find((x) => x.index === l.index);
      need(
        src && !seen.has(l.index) && l.barcode === src.barcode,
        "MIXED_LITERAL_IDENTITY_CHANGED",
      );
      seen.add(l.index);
      if (src.generic_debt)
        need(
          l.status === "UNKNOWN" &&
            l.delivered_qty === null &&
            l.pending_qty === null,
          "GENERIC_DEBT_QUANTITY_NOT_PHYSICAL",
        );
      else if (l.status === "UNKNOWN")
        need(
          l.delivered_qty === null && l.pending_qty === null,
          "UNKNOWN_IS_NOT_ZERO",
        );
      else
        need(
          l.status === "QUANTIFIED" &&
            quantity(l.delivered_qty) + quantity(l.pending_qty) ===
              quantity(src.quantity),
          "MIXED_QUANTITIES_DIFFER",
        );
    }
  } else
    need(
      observation.lines.length === 0,
      "DOCUMENT_STATEMENT_HAS_NO_INFERRED_LINE_QUANTITIES",
    );
  return {
    ...observation,
    authenticated_reviewer: false,
    operational_import_allowed: false,
    stock_delivery_allowed: false,
    decision_kind: "DOCUMENTARY_OBSERVATION_NOT_STOCK_AUTHORIZATION",
  };
}
export function buildDeliveryJournalRequest({
  archive,
  archive_payload_hash,
  packet,
  observation,
  request_id,
  expected_revision,
  assessed_at,
}) {
  need(
    UUID.test(request_id ?? "") &&
      SHA.test(archive_payload_hash ?? "") &&
      Number.isSafeInteger(expected_revision) &&
      expected_revision >= 0,
    "JOURNAL_REQUEST_METADATA_REQUIRED",
  );
  const account = archive.accounts.find((a) => a.key === packet.customer_key),
    doc = account?.documents.find((d) => d.key === packet.document_key);
  need(
    doc &&
      deliveryPacket(archive, account, doc).document_sha256 ===
        packet.document_sha256,
    "DOCUMENT_REVISION_CHANGED",
  );
  validateDeliveryObservation(packet, observation, assessed_at);
  const body = {};
  for (const k of [
    "reviewed_at",
    "reviewer_ref",
    "evidence_sha256",
    "statement",
    "lines",
    "documentary_only",
    "operational_import_allowed",
    "stock_delivery_allowed",
  ])
    body[k] = observation[k];
  // Expected full document is compared to SQL truth; the JS fingerprint is
  // deliberately not represented as a PostgreSQL JSONB hash.
  return {
    protocol: "m9-document-delivery-observation-1",
    project_id: STAGE,
    request_id,
    archive_sha256: archive.source_plan_sha256,
    document_key: doc.key,
    expected_archive_payload_hash: archive_payload_hash,
    expected_document: doc,
    expected_revision,
    action: "OBSERVE",
    revokes_request_id: null,
    observation: body,
  };
}
export function runLinesDelivery(configPath, outDir) {
  const config = JSON.parse(readFileSync(configPath, "utf8")),
    inputs = {};
  for (const [name, pin] of Object.entries(config.inputs)) {
    const bytes = readFileSync(pin.path);
    need(byteHash(bytes) === pin.sha256, "INPUT_SHA_CHANGED:" + name);
    inputs[name] = JSON.parse(bytes);
  }
  const plan = prepareLinesDelivery({
    ...inputs,
    assessed_at: config.assessed_at,
  });
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  for (const [name, value] of Object.entries({
    "plan-privado.json": plan,
    "resumen.json": {
      protocol: plan.protocol,
      ...plan.summary,
      operational_import_allowed: false,
      stock_delivery_allowed: false,
    },
  }))
    writeFileSync(join(outDir, name), JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
  return plan.summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(
    JSON.stringify(runLinesDelivery(process.argv[2], process.argv[3])),
  );
