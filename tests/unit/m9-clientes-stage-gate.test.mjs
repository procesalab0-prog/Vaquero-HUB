import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../../scripts/m9/acceleration.mjs";
import {
  evaluateClientesStages,
  clientesDocumentFingerprint,
  clientesStageReport,
  prepareClientesStages,
} from "../../scripts/m9/clientes-stage-gate.mjs";
const at = "2026-10-22T18:00:00Z",
  sourceSha = "a".repeat(64),
  evidence = "b".repeat(64),
  ref = "11111111-1111-4111-8111-111111111111",
  variant = "22222222-2222-4222-8222-222222222222",
  registry = "33333333-3333-4333-8333-333333333333",
  actor = "44444444-4444-4444-8444-444444444444",
  customer = digest({ tenant: "VSM", client_ref: ref });
function fixture(count = 1) {
  const plan = {
    version: "m9-general-credit-details-1",
    project_id: "zsezjtswqeijboezvado",
    production_allowed: false,
    operational_import_allowed: false,
    inventory_import_allowed: false,
    baseline_refreshed: false,
    simultaneous_closing_cut: false,
    issues: [],
    missing_expected: [],
    source_from: at,
    source_until: at,
    accounts: [
      {
        customer_key: customer,
        client_ref: ref,
        used_cents: count * 70000,
        holds: [],
        source_at: at,
      },
    ],
    documents: [],
    payments: [],
    lines: [],
  };
  for (let i = 1; i <= count; i++) {
    const folio = "VSM" + i,
      key = digest({ tenant: "VSM", client_ref: ref, folio }),
      payment = "Abono " + i;
    plan.documents.push({
      document_key: key,
      customer_key: customer,
      client_ref: ref,
      source_folio: folio,
      source_document_id: String(i).padStart(24, "a"),
      source_customer_name: "Nombre sintético",
      warehouse: "DEFAULT",
      due_date: "2026-11-22",
      total_cents: 100000,
      balance_cents: 70000,
      paid_to_date_cents: 30000,
      financial_status: "OPEN",
      linked_history_complete: true,
      source_at: at,
      source_evidence_sha256: evidence,
      holds: [],
      operational_import_allowed: false,
      delivery_status: "UNKNOWN",
    });
    plan.payments.push({
      payment_key: digest({ tenant: "VSM", source_ref: payment }),
      document_key: key,
      source_ref: payment,
      amount_cents: 30000,
      cancelled: false,
      replay_as_cash: false,
    });
    plan.lines.push({
      document_key: key,
      line_index: 0,
      barcode: "000123",
      quantity: "1",
      variant_id: variant,
      holds: ["DELIVERY_NOT_OBSERVED"],
      delivery_status: "UNKNOWN",
      reserved_qty: null,
      stock_deduction: null,
    });
  }
  const destination = {
    protocol: "m9-clientes-destination-snapshot-1",
    project_id: plan.project_id,
    captured_at: at,
    complete: true,
    sources: [
      {
        customer_key: customer,
        source_ref: ref,
        source_scope: "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS",
        batch_sha256: sourceSha,
        used_cents: count * 70000,
        target_customer_id: null,
        opening_event_id: null,
        reversed_event_id: null,
      },
    ],
    registries: [
      {
        customer_key: customer,
        registry_id: registry,
        batch_sha256: sourceSha,
      },
    ],
    documents: plan.documents.map((d) => ({
      document_key: d.document_key,
      customer_key: d.customer_key,
      source_folio: d.source_folio,
      source_document_id: d.source_document_id,
      total_cents: d.total_cents,
      balance_cents: d.balance_cents,
      paid_cents: d.paid_to_date_cents,
      due_date: d.due_date,
      financial_status: d.financial_status,
      opening_ledger_id: null,
      reversal_ledger_id: null,
    })),
    payments: plan.payments.map((p) => ({ ...p })),
    openings: [],
    native_openings: [],
    mapping: [{ barcode: "000123", variants: [variant] }],
  };
  const cut = {
    protocol: "m9-clientes-cut-1",
    project_id: plan.project_id,
    source_plan_sha256: sourceSha,
    source_from: at,
    source_until: at,
    account_keys: [customer],
    scope: "OBSERVED_INDEBTED_ACCOUNT_SUBSET",
    total_directory: false,
    warehouse: "Default",
    location_id: "467765fe-d18e-43bb-be68-326adbf05ce1",
    observed_balance_cents: count * 70000,
    evidence_sha256: evidence,
    includes_all_open_documents: true,
    warehouse_scope_confirmed: true,
    closing_confirmed: true,
    confirmed_at: at,
    confirmed_by: actor,
  };
  const reviews = plan.documents.map((d) => ({
    document_key: d.document_key,
    document_fingerprint: clientesDocumentFingerprint(plan, d.document_key),
    evidence_sha256: evidence,
    reviewed_by: actor,
    reviewed_at: at,
    source_identity_confirmed: true,
    current_finances_confirmed: true,
    target: "HERITAGE_REGISTRY",
    resolved_holds: [],
  }));
  return { plan, source_sha256: sourceSha, destination, cut, reviews };
}
const run = (input, when = at) => evaluateClientesStages(input, when);
const holds = (input) => run(input).documents[0].financial_holds;
function reReview(d) {
  d.reviews[0].document_fingerprint = clientesDocumentFingerprint(
    d.plan,
    d.plan.documents[0].document_key,
  );
}

it("allows only a staging rehearsal candidate, never an operational import or stock operation", () => {
  const input = fixture(),
    before = JSON.stringify(input),
    result = run(input);
  expect(result.documents[0].status).toBe("CANDIDATE_STAGING_REHEARSAL_ONLY");
  expect(result.summary.staging_rehearsal_candidate_cents).toBe(70000);
  expect(result.documents[0]).toMatchObject({
    reserve_qty: null,
    stock_deduction: null,
    delivery_status: "UNKNOWN",
    operational_import_allowed: false,
    inventory_import_allowed: false,
  });
  expect(result.documents[0].physical_holds).toContain(
    "DELIVERY_NOT_ACCREDITED",
  );
  expect(result.operational_import_allowed).toBe(false);
  expect(result.generates_import_sql).toBe(false);
  expect(JSON.stringify(input)).toBe(before);
});

it.each([
  ["old_source", "SOURCE_CUT_STALE_OR_FUTURE"],
  ["future_source", "SOURCE_CUT_STALE_OR_FUTURE"],
  ["old_destination", "DESTINATION_SNAPSHOT_STALE_OR_FUTURE"],
  ["future_destination", "DESTINATION_SNAPSHOT_STALE_OR_FUTURE"],
  ["no_cut", "CLOSING_CUT_NOT_ATTESTED"],
  ["not_confirmed", "CLOSING_CUT_NOT_ATTESTED"],
  ["old_cut_confirmation", "CLOSING_CUT_NOT_ATTESTED"],
  ["not_all_documents", "CLOSING_SCOPE_INCOMPLETE"],
  ["missing_account", "CLOSING_SCOPE_INCOMPLETE"],
  ["extra_account", "CLOSING_SCOPE_INCOMPLETE"],
  ["wrong_sum", "CLOSING_SCOPE_INCOMPLETE"],
  ["unconfirmed_warehouse", "CLOSING_CUT_NOT_ATTESTED"],
])("holds an unfit cut: %s", (kind, reason) => {
  const d = fixture();
  if (kind === "old_source")
    d.plan.documents[0].source_at = "2026-10-20T00:00:00Z";
  if (kind === "future_source") {
    d.plan.source_until = "2026-10-23T00:00:00Z";
    d.cut.source_until = d.plan.source_until;
  }
  if (kind === "old_destination")
    d.destination.captured_at = "2026-10-22T16:59:59Z";
  if (kind === "future_destination")
    d.destination.captured_at = "2026-10-23T00:00:00Z";
  if (kind === "no_cut") d.cut = null;
  if (kind === "not_confirmed") d.cut.closing_confirmed = false;
  if (kind === "old_cut_confirmation")
    d.cut.confirmed_at = "2026-10-20T00:00:00Z";
  if (kind === "not_all_documents") d.cut.includes_all_open_documents = false;
  if (kind === "missing_account") d.cut.account_keys = [];
  if (kind === "extra_account") d.cut.account_keys.push("f".repeat(64));
  if (kind === "wrong_sum") d.cut.observed_balance_cents++;
  if (kind === "unconfirmed_warehouse") d.cut.warehouse_scope_confirmed = false;
  expect(holds(d)).toContain(reason);
  expect(run(d).summary.staging_rehearsal_candidate_documents).toBe(0);
});

it.each([
  "prod_plan",
  "prod_destination",
  "wrong_source_sha",
  "wrong_location",
  "complete_directory_claim",
  "incomplete_destination",
  "duplicate_account",
  "duplicate_document",
  "duplicate_payment",
  "duplicate_registry",
  "guessed_delivery",
  "zero_reservation",
  "coerced_barcode",
  "wrong_amount",
  "unknown_payment_state",
  "source_key_changed",
])("rejects malformed or unsafe identity: %s", (kind) => {
  const d = fixture();
  if (kind === "prod_plan") d.plan.project_id = "drubkjlmfbdeglucakmg";
  if (kind === "prod_destination")
    d.destination.project_id = "drubkjlmfbdeglucakmg";
  if (kind === "wrong_source_sha") d.cut.source_plan_sha256 = "f".repeat(64);
  if (kind === "wrong_location") d.cut.location_id = actor;
  if (kind === "complete_directory_claim") d.cut.total_directory = true;
  if (kind === "incomplete_destination") d.destination.complete = false;
  if (kind === "duplicate_account") d.plan.accounts.push(d.plan.accounts[0]);
  if (kind === "duplicate_document") d.plan.documents.push(d.plan.documents[0]);
  if (kind === "duplicate_payment") d.plan.payments.push(d.plan.payments[0]);
  if (kind === "duplicate_registry")
    d.destination.registries.push(d.destination.registries[0]);
  if (kind === "guessed_delivery")
    d.plan.lines[0].delivery_status = "DELIVERED";
  if (kind === "zero_reservation") d.plan.lines[0].reserved_qty = 0;
  if (kind === "coerced_barcode") d.plan.lines[0].barcode = 123;
  if (kind === "wrong_amount") d.plan.documents[0].balance_cents++;
  if (kind === "unknown_payment_state") d.plan.payments[0].cancelled = null;
  if (kind === "source_key_changed")
    d.plan.accounts[0].customer_key = "f".repeat(64);
  expect(() => run(d)).toThrow();
});

it("compares each payment even when different payment identities leave the same balance", () => {
  const d = fixture(),
    p = d.destination.payments[0];
  p.source_ref = "Abono anterior";
  p.payment_key = digest({ tenant: "VSM", source_ref: p.source_ref });
  const r = run(d).documents[0];
  expect(r.payment_changes.map((x) => x.type)).toEqual([
    "PAYMENT_REMOVED",
    "PAYMENT_ADDED",
  ]);
  expect(r.financial_holds).toContain("HISTORICAL_PAYMENTS_CHANGED");
});
it.each([
  [true, false, "PAYMENT_CANCELLED"],
  [false, true, "PAYMENT_REACTIVATED"],
])(
  "holds active/cancelled changes even with a fresh identity review",
  (cancelled, before, change) => {
    const d = fixture();
    // Another active payment preserves source arithmetic while one changes state.
    const p = d.plan.payments[0];
    p.cancelled = cancelled;
    d.destination.payments[0].cancelled = before;
    if (cancelled) {
      d.plan.documents[0].paid_to_date_cents = 0;
      d.plan.documents[0].balance_cents = 100000;
      d.plan.accounts[0].used_cents = 100000;
      d.cut.observed_balance_cents = 100000;
    }
    reReview(d);
    expect(
      run(d).documents[0].payment_changes.some((x) => x.type === change),
    ).toBe(true);
    expect(holds(d)).toContain("HISTORICAL_PAYMENTS_CHANGED");
  },
);
it("detects changed historical amount independently from a newly reviewed source", () => {
  const d = fixture();
  d.destination.payments[0].amount_cents--;
  expect(run(d).documents[0].payment_changes[0].type).toBe(
    "PAYMENT_IDENTITY_OR_AMOUNT_CHANGED",
  );
});
it("does not open a compensated or already opened document again", () => {
  const d = fixture();
  for (const kind of ["OPEN", "REVERSE", "PAYMENT"]) {
    d.destination.openings = [
      {
        document_key: d.plan.documents[0].document_key,
        registry_id: registry,
        kind,
        amount_cents: kind === "OPEN" ? 70000 : -70000,
      },
    ];
    expect(holds(d)).toContain("OPENING_HISTORY_ALREADY_EXISTS");
  }
});
it.each([
  "native_ledger",
  "native_doc_link",
  "reversal_doc_link",
  "native_identity_link",
  "source_opening",
  "source_reversed",
])("blocks the alternate native opening path: %s", (kind) => {
  const d = fixture();
  if (kind === "native_ledger")
    d.destination.native_openings.push({
      document_key: d.plan.documents[0].document_key,
      kind: "CHARGE",
      amount_cents: 70000,
    });
  if (kind === "native_doc_link")
    d.destination.documents[0].opening_ledger_id = actor;
  if (kind === "reversal_doc_link")
    d.destination.documents[0].reversal_ledger_id = actor;
  if (kind === "native_identity_link")
    d.destination.sources[0].target_customer_id = actor;
  if (kind === "source_opening")
    d.destination.sources[0].opening_event_id = actor;
  if (kind === "source_reversed")
    d.destination.sources[0].reversed_event_id = actor;
  expect(holds(d).some((h) => /ALREADY_EXISTS/.test(h))).toBe(true);
});
it("requires exact account/registry and document adapters rather than matching a name", () => {
  const d = fixture();
  d.destination.sources = [];
  d.destination.registries = [];
  d.destination.documents = [];
  d.destination.payments = [];
  expect(holds(d)).toContain("SOURCE_REGISTRY_ADAPTER_REQUIRED");
  expect(holds(d)).toContain("GENERAL_SCOPE_DOCUMENT_ADAPTER_REQUIRED");
});
it("holds a whole account if one document is not ready", () => {
  const d = fixture(2);
  d.reviews.pop();
  const result = run(d);
  expect(result.summary.staging_rehearsal_candidate_documents).toBe(0);
  expect(result.documents.every((r) => r.status === "HOLD_ACCOUNT")).toBe(true);
  expect(
    result.documents.filter((r) =>
      r.financial_holds.includes("ACCOUNT_ATOMIC_STAGE_HELD"),
    ),
  ).toHaveLength(1);
});
it("does not reopen a paid document or infer delivery from payment", () => {
  const d = fixture();
  d.plan.documents[0].balance_cents = 0;
  d.plan.documents[0].paid_to_date_cents = 100000;
  d.plan.documents[0].financial_status = "PAID";
  d.plan.documents[0].due_date = null;
  d.plan.payments[0].amount_cents = 100000;
  d.plan.accounts[0].used_cents = 0;
  d.cut.observed_balance_cents = 0;
  const r = run(d);
  expect(r.documents[0].status).toBe("ARCHIVE_PAID_DO_NOT_REOPEN");
  expect(r.summary.staging_rehearsal_candidate_cents).toBe(0);
  expect(r.documents[0].delivery_status).toBe("UNKNOWN");
});
it("requires new review after any source change and cannot waive unknown history", () => {
  const d = fixture();
  d.plan.documents[0].linked_history_complete = false;
  expect(holds(d)).toContain("REVIEW_SOURCE_CHANGED");
  reReview(d);
  expect(holds(d)).toContain("ACTIVE_PAYMENT_SCOPE_NOT_ACCREDITED");
});
it("allows review of a concrete historical-name difference without approving delivery", () => {
  const d = fixture();
  d.plan.documents[0].holds.push("HISTORICAL_CUSTOMER_NAME_DIFFERS");
  reReview(d);
  expect(holds(d)).toContain("HISTORICAL_CUSTOMER_NAME_DIFFERS");
  d.reviews[0].resolved_holds.push("HISTORICAL_CUSTOMER_NAME_DIFFERS");
  expect(holds(d)).not.toContain("HISTORICAL_CUSTOMER_NAME_DIFFERS");
  expect(run(d).summary.delivery_operations_allowed).toBe(0);
});
it("does not permit a review to waive missing mapping, debt arithmetic, or delivery", () => {
  const d = fixture();
  d.reviews[0].resolved_holds.push("DELIVERY_NOT_OBSERVED");
  expect(() => run(d)).toThrow("REVIEW_EVIDENCE_INVALID");
});
it.each(["generic", "missing", "ambiguous", "price"])(
  "keeps merchandise pending: %s",
  (kind) => {
    const d = fixture();
    if (kind !== "price") d.plan.lines[0].variant_id = null;
    d.plan.lines[0].holds.push(
      kind === "price"
        ? "SOURCE_LINE_PRICE_REVIEW"
        : "LEGACY_GENERIC_DEBT_LINE",
    );
    reReview(d);
    expect(run(d).documents[0].physical_holds).toContain(
      "MERCHANDISE_LINK_OR_AMOUNT_REVIEW_REQUIRED",
    );
    expect(run(d).documents[0].money_opening_eligibility).toBe(
      "STAGING_REHEARSAL_CANDIDATE",
    );
  },
);
it("renders no names, folios, UUIDs or raw private evidence into the aggregate report", () => {
  const d = fixture(),
    html = clientesStageReport(run(d));
  expect(html).toContain("no abre deuda");
  expect(html).not.toContain("Nombre sintético");
  expect(html).not.toContain("VSM1");
  expect(html).not.toContain(ref);
  expect(html).not.toContain("000123");
  expect(html).not.toContain("<script");
});
it("does not generate a network or SQL importer", () => {
  const script = readFileSync(
    new URL("../../scripts/m9/clientes-stage-gate.mjs", import.meta.url),
    "utf8",
  );
  expect(script).not.toMatch(
    /fetch\(|https?:\/\/|\.rpc\(|COMMIT;|insert into (app|public)\./i,
  );
});

describe("pinned local preparation", () => {
  it("rejects changed files before processing or writing an output", () => {
    const dir = mkdtempSync(join(tmpdir(), "m9-stages-"));
    try {
      writeFileSync(join(dir, "source.json"), "{}");
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          assessment_at: at,
          inputs: {
            source_config: {
              path: "source.json",
              sha256: createHash("sha256").update("original").digest("hex"),
            },
            destination: null,
            cut: null,
            reviews: null,
          },
        }),
      );
      expect(() =>
        prepareClientesStages(join(dir, "config.json"), join(dir, "out")),
      ).toThrow("INPUT_CHANGED:source_config");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("accepts explicit zero active debt as a financial rehearsal candidate without inventing complete cancelled history", () => {
  const d = fixture();
  d.plan.documents[0].linked_history_complete = false;
  d.plan.documents[0].payment_evidence =
    "EXPLICIT_ZERO_ACTIVE_BREAKDOWN_LINKED_HISTORY_NOT_OBSERVED";
  d.plan.documents[0].paid_to_date_cents = 0;
  d.plan.documents[0].balance_cents = 100000;
  d.plan.payments = [];
  d.plan.accounts[0].used_cents = 100000;
  d.destination.documents[0].paid_cents = 0;
  d.destination.documents[0].balance_cents = 100000;
  d.destination.payments = [];
  d.destination.sources[0].used_cents = 100000;
  d.cut.observed_balance_cents = 100000;
  reReview(d);
  const r = run(d);
  expect(r.documents[0].money_opening_eligibility).toBe(
    "STAGING_REHEARSAL_CANDIDATE",
  );
  expect(r.documents[0].documentary_warnings).toContain(
    "CANCELLED_HISTORY_NOT_OBSERVED",
  );
  expect(r.documents[0].linked_history_complete).toBe(false);
  expect(r.historical_payments_replayed).toBe(false);
  expect(r.documents[0].delivery_operations_allowed).toBe(false);
  d.plan.documents[0].payment_evidence = undefined;
  reReview(d);
  expect(holds(d)).toContain("ACTIVE_PAYMENT_SCOPE_NOT_ACCREDITED");
});
it.each([
  { variants: [] },
  { variants: ["55555555-5555-4555-8555-555555555555"] },
  { variants: [variant, "55555555-5555-4555-8555-555555555555"] },
])(
  "keeps current mapping defects in the physical path independently from money eligibility",
  ({ variants }) => {
    const d = fixture();
    d.destination.mapping[0].variants = variants;
    const r = run(d).documents[0];
    expect(r.physical_holds).toContain(
      "CURRENT_LITERAL_VARIANT_MAPPING_CHANGED_OR_INCOMPLETE",
    );
    expect(r.money_opening_eligibility).toBe("STAGING_REHEARSAL_CANDIDATE");
    expect(r.stock_operations_allowed).toBe(false);
  },
);
it("does not let a synthetic registry stand in for a real SICAR account", () => {
  const d = fixture();
  d.destination.sources[0].source_scope = "SYNTHETIC_QA_NOT_SICAR";
  expect(holds(d)).toContain("SOURCE_REGISTRY_IDENTITY_MISMATCH");
});

it.each([
  "2026-02-31T00:00:00Z",
  "2026-10-22T18:00:00+00:00",
  "2026-10-22",
  "2026-10-22T24:00:00Z",
  "October 22, 2026",
])(
  "refuses noncanonical or normalized-impossible UTC assessment %s",
  (date) => {
    expect(() => run(fixture(), date)).toThrow(
      "COMPLETE_STAGING_DESTINATION_REQUIRED",
    );
  },
);
it.each([
  "2026-02-31T00:00:00Z",
  "2026-10-22T18:00:00+00:00",
  "2026-10-22T24:00:00Z",
])("cannot accept an impossible or noncanonical review date %s", (date) => {
  const d = fixture();
  d.reviews[0].reviewed_at = date;
  expect(() => run(d)).toThrow("REVIEW_EVIDENCE_INVALID");
});
it("rejects a normalized impossible due date and holds an unfit cut timestamp", () => {
  const d = fixture();
  d.plan.documents[0].due_date = "2026-02-31";
  expect(() => run(d)).toThrow("DOCUMENT_INVALID");
  const x = fixture();
  x.cut.confirmed_at = "2026-02-31T00:00:00Z";
  expect(holds(x)).toContain("CLOSING_CUT_NOT_ATTESTED");
});
it("preserves and quarantines a barcode with an internal control character instead of cleaning it", () => {
  const d = fixture(),
    code = "00\t0123";
  d.plan.lines[0].barcode = code;
  d.destination.mapping[0].barcode = code;
  reReview(d);
  const before = JSON.stringify(d),
    r = run(d).documents[0];
  expect(r.physical_holds).toContain("BARCODE_CONTROL_CHARACTER_REVIEW");
  expect(r.stock_operations_allowed).toBe(false);
  expect(JSON.stringify(d)).toBe(before);
  expect(d.plan.lines[0].barcode).toBe(code);
});
it("holds a document from a different warehouse despite an otherwise valid Default closing attestation", () => {
  const d = fixture();
  d.plan.documents[0].warehouse = "OTRO";
  reReview(d);
  expect(holds(d)).toContain("DOCUMENT_WAREHOUSE_SCOPE_DIFFERS");
});
it("does not accept a cut with unresolved source reconciliation or missing expected documents", () => {
  const d = fixture();
  d.plan.missing_expected.push("c".repeat(64));
  expect(holds(d)).toContain("SOURCE_RECONCILIATION_INCOMPLETE");
  const x = fixture();
  x.plan.issues.push({ code: "UNREAD_DOCUMENT" });
  expect(holds(x)).toContain("SOURCE_RECONCILIATION_INCOMPLETE");
});
