import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./acceleration.mjs";
import { creditDetailArchive } from "./archive-credit-details.mjs";
import { creditDetailLines } from "./reconcile-general-credit-details.mjs";
import {
  censusCanonicalUTC,
  censusRenewalDelta,
} from "./prepare-general-customers.mjs";

const project = "zsezjtswqeijboezvado";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const needed = (condition, code) => {
  if (!condition) throw Error(code);
};
const cents = (v) => Number.isSafeInteger(v) && v >= 0;
const literal = (v) =>
  typeof v === "string" && v.length > 0 && v === v.trim() && !/\p{Cc}/u.test(v);
const add = (xs) => {
  const n = xs.reduce((a, b) => a + BigInt(b), 0n);
  needed(n <= BigInt(Number.MAX_SAFE_INTEGER), "BRIDGE_UNSAFE_SUM");
  return Number(n);
};
const key = (ref, folio) => digest({ tenant: "VSM", client_ref: ref, folio });
const accountKey = (ref) => digest({ tenant: "VSM", client_ref: ref });
const documentSignature = (docs) =>
  digest(
    docs
      .map((d) => ({
        key: d.key,
        folio: d.folio,
        total_cents: d.total_cents,
        balance_cents: d.balance_cents,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
const paymentSignature = (docs) =>
  digest(
    docs
      .flatMap((d) =>
        d.payments.map((p) => ({
          document_key: d.key,
          key: p.key,
          ref: p.ref,
          amount_cents: p.amount_cents,
          cancelled: p.cancelled,
        })),
      )
      .sort((a, b) => a.key.localeCompare(b.key)),
  );

function censusAccounts(c, at) {
  needed(
    ["m9-census-archive-1", "m9-census-archive-renewal-1"].includes(
      c?.protocol,
    ) &&
      c.scope === "VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY" &&
      /^[a-f0-9]{64}$/.test(c.source_plan_sha256 ?? "") &&
      Array.isArray(c.accounts) &&
      c.accounts.length > 0,
    "BRIDGE_CENSUS_REQUIRED",
  );
  censusCanonicalUTC(c.source_at);
  censusCanonicalUTC(c.observed_until);
  needed(
    c.source_at <= c.observed_until && c.observed_until <= at,
    "BRIDGE_CENSUS_DATE_INVALID",
  );
  if (c.protocol === "m9-census-archive-renewal-1")
    needed(
      c.archive_only === true && c.operational_import_allowed === false,
      "BRIDGE_OPERATION_FORBIDDEN",
    );
  const result = new Map(),
    documentKeys = new Set();
  for (const a of c.accounts) {
    needed(
      /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.ref ?? "") &&
        a.key === accountKey(a.ref) &&
        !result.has(a.key) &&
        literal(a.name) &&
        cents(a.used_cents) &&
        Array.isArray(a.documents),
      "BRIDGE_CENSUS_ACCOUNT_INVALID",
    );
    censusCanonicalUTC(a.source_at);
    needed(
      a.source_at >= c.source_at && a.source_at <= c.observed_until,
      "BRIDGE_CENSUS_DATE_INVALID",
    );
    for (const d of a.documents) {
      needed(
        literal(d.folio) &&
          d.key === key(a.ref, d.folio) &&
          !documentKeys.has(d.key) &&
          cents(d.total_cents) &&
          d.total_cents > 0 &&
          cents(d.balance_cents) &&
          d.balance_cents > 0 &&
          d.balance_cents <= d.total_cents,
        "BRIDGE_CENSUS_DOCUMENT_INVALID",
      );
      documentKeys.add(d.key);
    }
    needed(
      add(a.documents.map((d) => d.balance_cents)) === a.used_cents,
      "BRIDGE_CENSUS_TOTALS_DIFFER",
    );
    result.set(a.key, a);
  }
  return result;
}

function detailAccounts(archive, at) {
  needed(
    archive?.protocol === "m9-credit-detail-archive-1" &&
      archive.operational_import_allowed === false &&
      Array.isArray(archive.accounts) &&
      /^[a-f0-9]{64}$/.test(archive.source_plan_sha256 ?? ""),
    "BRIDGE_DETAIL_ARCHIVE_REQUIRED",
  );
  censusCanonicalUTC(archive.source_from);
  censusCanonicalUTC(archive.source_until);
  needed(
    archive.source_from <= archive.source_until && archive.source_until <= at,
    "BRIDGE_DETAIL_DATE_INVALID",
  );
  const result = new Map(),
    docKeys = new Set(),
    sourceIds = new Set(),
    paymentKeys = new Set();
  for (const a of archive.accounts) {
    needed(
      a.key === accountKey(a.ref) &&
        !result.has(a.key) &&
        literal(a.name) &&
        cents(a.balance_cents) &&
        Array.isArray(a.documents),
      "BRIDGE_DETAIL_IDENTITY_INVALID",
    );
    censusCanonicalUTC(a.source_at);
    needed(
      a.source_at >= archive.source_from && a.source_at <= archive.source_until,
      "BRIDGE_DETAIL_DATE_INVALID",
    );
    for (const d of a.documents) {
      needed(
        literal(d.folio) &&
          d.key === key(a.ref, d.folio) &&
          !docKeys.has(d.key) &&
          /^[a-f0-9]{24}$/.test(d.source_id ?? "") &&
          !sourceIds.has(d.source_id) &&
          cents(d.total_cents) &&
          d.total_cents > 0 &&
          cents(d.balance_cents) &&
          cents(d.paid_cents) &&
          d.total_cents === add([d.balance_cents, d.paid_cents]) &&
          Array.isArray(d.payments) &&
          Array.isArray(d.lines) &&
          Array.isArray(d.holds) &&
          typeof d.linked_history_complete === "boolean",
        "BRIDGE_DETAIL_DOCUMENT_INVALID",
      );
      censusCanonicalUTC(d.source_at);
      needed(
        d.source_at >= archive.source_from &&
          d.source_at <= archive.source_until,
        "BRIDGE_DETAIL_DATE_INVALID",
      );
      docKeys.add(d.key);
      sourceIds.add(d.source_id);
      for (const p of d.payments) {
        needed(
          /^Abono [0-9]+$/.test(p.ref ?? "") &&
            p.key === digest({ tenant: "VSM", source_ref: p.ref }) &&
            !paymentKeys.has(p.key) &&
            typeof p.cancelled === "boolean" &&
            cents(p.amount_cents) &&
            p.amount_cents > 0,
          "BRIDGE_PAYMENT_INVALID",
        );
        paymentKeys.add(p.key);
      }
      needed(
        add(
          d.payments.filter((p) => !p.cancelled).map((p) => p.amount_cents),
        ) === d.paid_cents,
        "BRIDGE_ACTIVE_PAYMENTS_DIFFER",
      );
      needed(
        d.linked_history_complete ||
          (d.paid_cents === 0 && d.payments.length === 0),
        "BRIDGE_PAYMENT_HISTORY_UNOBSERVED",
      );
      for (const l of d.lines)
        needed(
          literal(l.barcode) &&
            l.delivery_status === "UNKNOWN" &&
            l.reserved_qty === null &&
            l.stock_deduction === null,
          "BRIDGE_PHYSICAL_EFFECT_FORBIDDEN",
        );
    }
    needed(
      add(a.documents.map((d) => d.balance_cents)) === a.balance_cents,
      "BRIDGE_DETAIL_TOTALS_DIFFER",
    );
    result.set(a.key, a);
  }
  return result;
}

// The raw text is retained separately. Only a position observed as generic in
// independently captured AX roles can be excluded from an item extraction.
export function corroborateRenderedItemRoles(
  detail,
  proof,
  assessmentAt,
  approvedMarkers,
) {
  needed(
    Array.isArray(approvedMarkers) &&
      approvedMarkers.length > 0 &&
      approvedMarkers.every(literal) &&
      new Set(approvedMarkers).size === approvedMarkers.length,
    "BRIDGE_ITEM_EXPLICIT_MARKER_APPROVAL_REQUIRED",
  );
  const approved = new Set(approvedMarkers);
  censusCanonicalUTC(assessmentAt);
  censusCanonicalUTC(detail.captured_at);
  censusCanonicalUTC(proof.captured_at);
  needed(
    proof.purpose === "RENDERED_ROLE_EXTRACTION_SUPPORT_ONLY" &&
      proof.source_read_only === true &&
      detail.full_reload_before_read === true &&
      detail.delivery_status === "UNKNOWN" &&
      proof.client_ref === detail.client_ref &&
      proof.folio === detail.folio &&
      proof.captured_at >= detail.captured_at &&
      proof.captured_at <= assessmentAt &&
      typeof proof.ax_snapshot === "string" &&
      typeof proof.rendered_detail_text === "string" &&
      Array.isArray(proof.paragraph_nodes),
    "BRIDGE_ITEM_ROLE_PROOF_REQUIRED",
  );
  const sourceId = (text) => {
    const ids = [...text.matchAll(/Cód Doc[.] ([a-f0-9]{24})\b/g)];
    needed(ids.length === 1, "BRIDGE_ITEM_SOURCE_ID_REQUIRED");
    return ids[0][1];
  };
  const source = sourceId(detail.detail_text);
  needed(
    sourceId(proof.ax_snapshot) === source &&
      sourceId(proof.rendered_detail_text) === source,
    "BRIDGE_ITEM_SOURCE_ID_DIFFERS",
  );
  const section = (text) => {
    const lines = text.split("\n"),
      start = lines.indexOf("Cantidad"),
      end = lines.indexOf("Formas de Pago/Abonos");
    needed(
      start >= 0 && end > start && lines.lastIndexOf("Cantidad") === start,
      "BRIDGE_ITEM_SECTION_AMBIGUOUS",
    );
    return {
      lines,
      positions: lines
        .map((text, index) => ({ text, index }))
        .filter(
          (r) => r.index >= start && r.index < end && r.text.trim().length > 0,
        ),
    };
  };
  const raw = section(detail.detail_text),
    rendered = section(proof.rendered_detail_text),
    axLines = proof.ax_snapshot.split("\n"),
    start = axLines.findIndex((l) => /^\s*- paragraph: Cantidad$/.test(l)),
    end = axLines.findIndex((l) =>
      l.includes('- button "Formas de Pago/Abonos"'),
    );
  needed(start >= 0 && end > start, "BRIDGE_ITEM_AX_SECTION_REQUIRED");
  const roles = axLines
    .slice(start, end)
    .filter((l) => l.trim())
    .map((line) => {
      const m = /^\s*- (paragraph|generic): (.+)$/.exec(line);
      needed(m, "BRIDGE_ITEM_AX_ROLE_AMBIGUOUS");
      const text = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2];
      needed(literal(text), "BRIDGE_ITEM_AX_LITERAL_REQUIRED");
      return { role: m[1], text };
    });
  needed(
    digest(roles.map((r) => r.text)) ===
      digest(raw.positions.map((r) => r.text)) &&
      digest(roles.map((r) => r.text)) ===
        digest(rendered.positions.map((r) => r.text)),
    "BRIDGE_ITEM_RENDERED_CONTENT_CHANGED",
  );
  const paragraphs = roles
      .filter((r) => r.role === "paragraph")
      .map((r) => r.text),
    firstItem = paragraphs.findIndex((p) => /^[1-9]\d{0,8} PZA$/.test(p)),
    itemParagraphs = paragraphs.slice(firstItem);
  needed(
    firstItem >= 0 &&
      proof.paragraph_nodes.some((_, index) =>
        itemParagraphs.every(
          (text, offset) => proof.paragraph_nodes[index + offset] === text,
        ),
      ),
    "BRIDGE_ITEM_DOM_PARAGRAPHS_DIFFER",
  );
  for (const [index, role] of roles.entries()) {
    if (role.role !== "generic") continue;
    const preceding = roles[index - 1],
      following = roles.slice(index + 1, index + 5);
    needed(
      approved.has(role.text) &&
        preceding?.role === "paragraph" &&
        /^[1-9]\d{0,8} PZA$/.test(preceding.text) &&
        following.length === 4 &&
        following.every((r) => r.role === "paragraph") &&
        /^\$[0-9,.]+$/.test(following[2].text) &&
        /^\$[0-9,.]+$/.test(following[3].text),
      "BRIDGE_ITEM_GENERIC_POSITION_UNPROVEN",
    );
  }
  const removed = roles.flatMap((r, index) =>
    r.role === "generic"
      ? [{ index: raw.positions[index].index, text: r.text }]
      : [],
  );
  needed(removed.length > 0, "BRIDGE_ITEM_NO_DECORATIVE_ROLES");
  const remove = new Set(removed.map((r) => r.index)),
    text = raw.lines.filter((_, index) => !remove.has(index)).join("\n"),
    items = creditDetailLines(text);
  needed(
    items.length ===
      itemParagraphs.filter((p) => /^[1-9]\d{0,8} PZA$/.test(p)).length,
    "BRIDGE_ITEM_SCOPE_DIFFERS",
  );
  return {
    ...detail,
    detail_text: text,
    item_role_corroboration: {
      protocol: "m9-rendered-item-role-corroboration-1",
      source_id: source,
      purpose: proof.purpose,
      captured_at: proof.captured_at,
      proof_sha256: sha(JSON.stringify(proof)),
      raw_detail_text_sha256: sha(detail.detail_text),
      extracted_detail_text_sha256: sha(text),
      removed_rendered_generic_nodes: removed,
      original_capture_at: detail.captured_at,
      source_capture_refreshed: false,
    },
  };
}

// Compares evidence only. It never emits a writer, opening, payment or closure.
export function buildCensusDetailBridge({
  previous,
  current,
  archive,
  renewed = null,
  assessment_at,
}) {
  censusCanonicalUTC(assessment_at);
  const old = censusAccounts(previous, assessment_at),
    now = censusAccounts(current, assessment_at),
    archived = detailAccounts(archive, assessment_at),
    refresh = renewed ? detailAccounts(renewed, assessment_at) : null;
  needed(previous.observed_until < current.source_at, "BRIDGE_CENSUS_OVERLAP");
  if (current.expected_context)
    needed(
      current.expected_context.prior_archive.source_plan_sha256 ===
        previous.source_plan_sha256,
      "BRIDGE_PRIOR_CHANGED",
    );
  const delta = censusRenewalDelta(previous, current.accounts);
  if (current.delta)
    needed(digest(current.delta) === digest(delta), "BRIDGE_DELTA_CHANGED");
  const changed = [
    ...new Set([
      ...delta.balance_changed_keys,
      ...delta.documents_changed_keys,
    ]),
  ].sort();
  needed(changed.length > 0, "BRIDGE_NO_DOCUMENTARY_DIFFERENCES");
  if (refresh)
    needed(
      refresh.size === changed.length && changed.every((k) => refresh.has(k)),
      "BRIDGE_REFRESH_SCOPE_INVALID",
    );
  const queue = [],
    rows = [];
  for (const k of changed) {
    const before = old.get(k),
      after = now.get(k),
      evidence = archived.get(k),
      fresh = refresh?.get(k),
      holds = [];
    const union = new Map(
      [...before.documents, ...after.documents].map((d) => [d.key, d]),
    );
    const match = (a) =>
      !!a &&
      a.ref === after.ref &&
      a.name === after.name &&
      a.balance_cents === after.used_cents &&
      documentSignature(a.documents.filter((d) => d.balance_cents > 0)) ===
        documentSignature(after.documents) &&
      [...union.keys()].every((dk) => a.documents.some((d) => d.key === dk));
    if (!match(evidence)) holds.push("ARCHIVED_DETAIL_DIFFERS_OR_INCOMPLETE");
    if (
      evidence &&
      (evidence.source_at <= before.source_at ||
        evidence.source_at > after.source_at ||
        evidence.documents.some(
          (d) =>
            d.source_at <= before.source_at || d.source_at > after.source_at,
        ))
    )
      holds.push("ARCHIVED_EVIDENCE_OUTSIDE_CENSUS_INTERVAL");
    const docs = [...union.values()].map((d) => {
      const priorDoc = before.documents.find((x) => x.key === d.key),
        currentDoc = after.documents.find((x) => x.key === d.key),
        observed = evidence?.documents.find((x) => x.key === d.key);
      if (observed && priorDoc && observed.total_cents !== priorDoc.total_cents)
        holds.push("ARCHIVED_DOCUMENT_TOTAL_CHANGED");
      if (observed?.holds.includes("SOURCE_ID_CHANGED"))
        holds.push("ARCHIVED_SOURCE_ID_REVIEW");
      if (
        !currentDoc &&
        !(
          observed &&
          observed.balance_cents === 0 &&
          observed.linked_history_complete &&
          observed.paid_cents === observed.total_cents
        )
      )
        holds.push("DISAPPEARANCE_WITHOUT_PAID_BREAKDOWN");
      queue.push({
        client_ref: after.ref,
        folio: d.folio,
        document_key: d.key,
        expected_name: after.name,
        expected_total_cents: (priorDoc ?? currentDoc).total_cents,
        expected_balance_cents: (priorDoc ?? currentDoc).balance_cents,
        expected_source_document_id: observed?.source_id ?? null,
        delivery_status: "UNKNOWN",
        operational_import_allowed: false,
      });
      return {
        key: d.key,
        folio: d.folio,
        source_id: observed?.source_id ?? null,
        prior_open_balance_cents: priorDoc?.balance_cents ?? null,
        current_open_balance_cents: currentDoc?.balance_cents ?? null,
        archived_detail: observed ?? null,
        interpretation: !currentDoc
          ? "ABSENT_FROM_OPEN_CENSUS_NOT_A_PAYMENT"
          : !priorDoc
            ? "ADDITIONAL_OPEN_DOCUMENT_NOT_NEW_NATIVE_DEBT"
            : "OPEN_DOCUMENT_OBSERVED",
      };
    });
    const historicalAligned = holds.length === 0;
    if (!fresh) holds.push("NO_LATER_DETAIL_REOBSERVATION");
    else {
      if (!match(fresh)) holds.push("REOBSERVED_DETAIL_DIFFERS_OR_INCOMPLETE");
      if (
        fresh.source_at <= after.source_at ||
        fresh.documents.some((d) => d.source_at <= after.source_at)
      )
        holds.push("DETAIL_REOBSERVATION_NOT_AFTER_CENSUS");
      if (evidence) {
        for (const d of fresh.documents) {
          const priorDoc = evidence.documents.find((x) => x.key === d.key);
          if (!priorDoc || priorDoc.source_id !== d.source_id)
            holds.push("REOBSERVED_DOCUMENT_IDENTITY_CHANGED");
          if (
            priorDoc &&
            digest(
              priorDoc.lines.map((l) => ({
                index: l.index,
                barcode: l.barcode,
                quantity: l.quantity,
                description: l.description,
              })),
            ) !==
              digest(
                d.lines.map((l) => ({
                  index: l.index,
                  barcode: l.barcode,
                  quantity: l.quantity,
                  description: l.description,
                })),
              )
          )
            holds.push("REOBSERVED_LINE_CONTENT_CHANGED");
        }
        if (
          paymentSignature(evidence.documents) !==
          paymentSignature(fresh.documents)
        )
          holds.push("REOBSERVED_PAYMENT_HISTORY_CHANGED");
      }
      if (fresh.documents.some((d) => d.holds.includes("SOURCE_ID_CHANGED")))
        holds.push("REOBSERVED_SOURCE_ID_REVIEW");
    }
    rows.push({
      key: k,
      ref: after.ref,
      name: after.name,
      previous_used_cents: before.used_cents,
      current_used_cents: after.used_cents,
      archived_used_cents: evidence?.balance_cents ?? null,
      previous_source_at: before.source_at,
      current_source_at: after.source_at,
      archived_source_at: evidence?.source_at ?? null,
      renewed_source_at: fresh?.source_at ?? null,
      historical_evidence_aligned: historicalAligned,
      evidence_alignment_complete: holds.length === 0,
      holds: [...new Set(holds)].sort(),
      documents: docs,
      renewed_detail: fresh ?? null,
      operational_import_allowed: false,
      close_operating_debt: false,
      replay_payments_as_cash: false,
      delivery_status: "UNKNOWN",
      stock_deduction: null,
    });
  }
  const additional = delta.added_keys.filter((k) => !archived.has(k));
  return {
    protocol: "m9-census-detail-bridge-1",
    project_id: project,
    assessed_at: assessment_at,
    mode: "READ_ONLY_EVIDENCE_BRIDGE",
    operational_import_allowed: false,
    source_registry_changes: 0,
    financial_openings: 0,
    debt_closures: 0,
    cash_replays: 0,
    stock_movements: 0,
    current_census_is_simultaneous_cut: false,
    source_dates_preserved: true,
    archived_detail_dates: {
      from: archive.source_from,
      until: archive.source_until,
    },
    summary: {
      changed_accounts: rows.length,
      historical_evidence_aligned: rows.filter(
        (a) => a.historical_evidence_aligned,
      ).length,
      evidence_alignment_complete: rows.filter(
        (a) => a.evidence_alignment_complete,
      ).length,
      detail_documents_in_review: rows.reduce(
        (s, a) => s + a.documents.length,
        0,
      ),
      current_open_documents_in_review: rows.reduce(
        (s, a) => s + now.get(a.key).documents.length,
        0,
      ),
      additional_census_accounts_without_archived_detail: additional.length,
      additional_census_observed_cents: add(
        additional.map((k) => now.get(k).used_cents),
      ),
    },
    delta,
    additional_unreviewed_keys: additional,
    accounts: rows,
    capture_queue: queue,
  };
}

export function prepareCensusDetailBridge(configPath, out) {
  const cfg = JSON.parse(readFileSync(configPath)),
    data = {},
    pins = {};
  needed(
    cfg.mode === "READ_ONLY_EVIDENCE_BRIDGE" && cfg.project_id === project,
    "BRIDGE_CONFIG_REQUIRED",
  );
  const names = [
    "previous",
    "current",
    "detail_plan",
    "detail_accounts",
    "archive",
    "archive_context",
  ];
  needed(
    !!cfg.inputs.renewed_plan === !!cfg.inputs.renewed_accounts,
    "BRIDGE_REFRESH_PIN_PAIR_REQUIRED",
  );
  if (cfg.inputs.renewed_plan) names.push("renewed_plan", "renewed_accounts");
  for (const n of names) {
    const pin = cfg.inputs[n];
    needed(
      typeof pin?.path === "string" && /^[a-f0-9]{64}$/.test(pin.sha256 ?? ""),
      "BRIDGE_PIN_REQUIRED:" + n,
    );
    const raw = readFileSync(resolve(dirname(configPath), pin.path));
    needed(sha(raw) === pin.sha256, "BRIDGE_INPUT_CHANGED:" + n);
    data[n] = JSON.parse(raw);
    pins[n] = pin.sha256;
  }
  const rebuilt = creditDetailArchive(
    data.detail_plan,
    pins.detail_plan,
    data.detail_accounts,
    pins.detail_accounts,
  );
  needed(
    digest(rebuilt) === digest(data.archive),
    "BRIDGE_ARCHIVE_PREIMAGE_DIFFERS",
  );
  const ctx = data.archive_context;
  needed(
    ctx.source_plan_sha256 === data.archive.source_plan_sha256 &&
      /^[a-f0-9]{64}$/.test(ctx.payload_hash ?? "") &&
      ctx.payload_hash === ctx.actual_payload_hash &&
      ctx.accounts === data.archive.accounts.length &&
      ctx.documents ===
        data.archive.accounts.reduce((s, a) => s + a.documents.length, 0) &&
      ctx.source_from === data.archive.source_from &&
      ctx.source_until === data.archive.source_until,
    "BRIDGE_ARCHIVED_CONTEXT_DIFFERS",
  );
  const renewed = data.renewed_plan
    ? creditDetailArchive(
        data.renewed_plan,
        pins.renewed_plan,
        data.renewed_accounts,
        pins.renewed_accounts,
      )
    : null;
  const result = {
    ...buildCensusDetailBridge({
      previous: data.previous,
      current: data.current,
      archive: data.archive,
      renewed,
      assessment_at: cfg.assessment_at,
    }),
    inputs: pins,
    archived_context: ctx,
    partial_detail_archive_commit_allowed: false,
  };
  mkdirSync(out, { mode: 0o700 });
  const files = {
    "puente-privado.json": JSON.stringify(result, null, 2) + "\n",
    "resumen.json": JSON.stringify(result.summary, null, 2) + "\n",
    "cola-detalles.json": JSON.stringify(result.capture_queue, null, 2) + "\n",
  };
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(out, name), content, { flag: "wx", mode: 0o600 });
  writeFileSync(
    join(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([n, c]) => [n, sha(c)])),
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return result.summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  needed(process.argv.length === 4, "Usage: PINNED_CONFIG NEW_OUTPUT");
  console.log(
    JSON.stringify(
      prepareCensusDetailBridge(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
