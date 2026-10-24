import { describe, it, expect } from "vitest";
import { pilotOperationalControl } from "../../lib/m9-pilot-operational-control";
import { controlFixture, declareFields } from "./fixtures/m9-pilot-operational";
const run = pilotOperationalControl;
describe("pilot review inputs, never operational eligibility", () => {
  it("keeps36UNKNOWN, trial book and183sourceUNKNOWN separately without PII", () => {
    const r = run(controlFixture());
    expect(r.inventory).toMatchObject({
      unknown: 36,
      declared_current: 0,
      complete_codes: 0,
      review_inputs_complete: false,
      import_allowed: false,
    });
    expect(r.financial).toMatchObject({
      accounts: 7,
      documents: 7,
      opening_eligibility: "NOT_ASSESSED",
    });
    expect(r.delivery).toMatchObject({
      source_unknown_lines: 183,
      current_pilot_commitments: "NOT_ASSESSED",
      physical_delivery: "UNKNOWN",
      stock_allowed: false,
    });
    expect(r.cuts.review_inputs_recent).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(
      /PRIVATE_SYNTHETIC|219000|SYNTHETIC QA ACTOR/,
    );
    expect(r.operational_authorization).toBe(false);
  });
  it("zero explicitly declared is evidence; a zero without evidence stays unattributed", () => {
    const input = controlFixture();
    declareFields(input);
    expect(run(input).inventory).toMatchObject({
      unknown: 33,
      declared_current: 3,
      unattributed: 0,
      complete_codes: 1,
    });
    input.registry.stock[0].field_evidence = {};
    expect(run(input).inventory).toMatchObject({
      unknown: 33,
      declared_current: 0,
      unattributed: 3,
      complete_codes: 0,
    });
  });
  it("baseline/hash/quantity/revision drift holds declarations without recertifying", () => {
    for (const mutation of ["baseline", "hash", "quantity", "revision"]) {
      const input = controlFixture();
      declareFields(input);
      const row = input.registry.stock[0];
      if (mutation === "baseline") row.balance_current = false;
      if (mutation === "hash") row.field_source_sha256 = "9".repeat(64);
      if (mutation === "quantity") row.physical_qty = 1;
      if (mutation === "revision") row.revision = 0;
      if (mutation === "revision") expect(() => run(input)).toThrow();
      else expect(run(input).inventory.declared_current).toBeLessThan(3);
    }
  });
  it("all36current and all84concrete still grant no reservation or opening", () => {
    const input = controlFixture();
    for (let i = 0; i < 12; i++) declareFields(input, i);
    input.delivery.summary.concrete_documentary_reviews = 84;
    input.delivery.summary.pending_documentary_reviews = 0;
    const r = run(input);
    expect(r.inventory.review_inputs_complete).toBe(true);
    expect(r.stock_or_reservation_allowed).toBe(false);
    expect(r.collect_allowed).toBe(false);
    expect(r.financial.opening_eligibility).toBe("NOT_ASSESSED");
    expect(r.delivery.physical_delivery).toBe("UNKNOWN");
  });
  it("rejects V+S exceeding physical before declaring a complete input", () => {
    const input = controlFixture();
    const r = input.registry.stock[0];
    r.physical_qty = 1;
    r.sold_waiting_qty = 1;
    r.separated_qty = 1;
    input.overview.inventory.pending_fields = 33;
    expect(() => run(input)).toThrow("M9_COMMITMENTS_EXCEED_PHYSICAL");
  });
  it.each(["code", "variant", "branch", "partial"])(
    "rejects scope drift %s without replacing literal codes",
    (kind) => {
      const input = controlFixture();
      const r = input.registry.stock[0];
      if (kind === "code") r.barcode = "02396";
      if (kind === "variant") r.variant_id = input.registry.stock[1].variant_id;
      if (kind === "branch")
        r.location_id = "00000000-0000-0000-0000-000000000001";
      if (kind === "partial") input.registry.stock.pop();
      expect(() => run(input)).toThrow();
    },
  );
  it.each([
    "registry-page",
    "registry-total",
    "registry-count",
    "doc-page",
    "doc-total",
    "doc-rows",
    "doc-source",
    "doc-summary",
    "age",
  ])("rejects inconsistent reading %s", (kind) => {
    const input = controlFixture();
    if (kind === "registry-page") input.registry.pages = 5;
    if (kind === "registry-total") input.registry.total = 113;
    if (kind === "registry-count") input.registry.customers.pop();
    if (kind === "doc-page") input.delivery.page = 2;
    if (kind === "doc-total") input.delivery.total = 83;
    if (kind === "doc-rows") input.delivery.rows.pop();
    if (kind === "doc-source")
      input.delivery.source_until = "2026-10-22T18:11:00.000Z";
    if (kind === "doc-summary")
      input.overview.customers.unconfirmed_deliveries = 182;
    if (kind === "age") input.delivery.source_older_than_24h = false;
    expect(() => run(input)).toThrow();
  });
  it.each([
    "2026-02-31T12:00:00Z",
    "today",
    "2026-10-24",
    "2026-10-24T02:01:00Z",
  ])("rejects invalid/future observed date %s", (value) => {
    const input = controlFixture();
    input.overview.assembled_at = value;
    expect(() => run(input)).toThrow();
  });
  it("expired evaluation cannot renew evidence by generating a report", () => {
    const input = controlFixture();
    input.assessedAt = "2026-10-24T02:16:00.000Z";
    expect(() => run(input)).toThrow("READING_WINDOW_EXPIRED");
  });
  it("uses earliest source time and preserves literals rather than a new generation date", () => {
    const input = controlFixture();
    const r = run(input);
    expect(r.cuts.detail.from).toBe(input.delivery.source_from);
    expect(r.inventory.source_dates).toEqual(["2026-10-20T14:00:00.000Z"]);
    expect(r.assessed_at).toBe(input.assessedAt);
  });
  it.each([
    "finance-null",
    "finance-rows",
    "finance-duplicate",
    "finance-over",
    "finance-enabled",
  ])("rejects finance evidence %s instead of zero", (kind) => {
    const input = controlFixture();
    if (kind === "finance-null") Object.assign(input, { finance: null });
    if (kind === "finance-rows") input.finance.accounts[0].entries = [];
    if (kind === "finance-duplicate")
      input.finance.accounts[0].id = input.finance.accounts[1].id;
    if (kind === "finance-over")
      input.finance.accounts[0].balance_cents = 219001;
    if (kind === "finance-enabled")
      input.finance.cash_collection_enabled = true;
    expect(() => run(input)).toThrow();
  });
  it("a smaller preserved book balance does not invent a new payment or refresh", () => {
    const input = controlFixture();
    input.finance.accounts[0].balance_cents = 100;
    const r = run(input);
    expect(r.financial.opening_eligibility).toBe("NOT_ASSESSED");
    expect(r.cuts.operating_cut_authorized).toBe(false);
  });
  it("orders UTC instants to six fractions, preserving mixed PG/ISO literals", () => {
    const input = controlFixture();
    input.delivery.source_from = "2026-10-22 18:00:00.000001+00";
    input.delivery.source_until = "2026-10-22T18:00:00.000002+00:00";
    input.overview.customers.details_from = input.delivery.source_from;
    input.overview.customers.details_until = input.delivery.source_until;
    input.delivery.rows.forEach(
      (r) => (r.source_at = input.delivery.source_from),
    );
    expect(run(input).cuts.detail.from).toBe(input.delivery.source_from);
    [input.delivery.source_from, input.delivery.source_until] = [
      input.delivery.source_until,
      input.delivery.source_from,
    ];
    input.overview.customers.details_from = input.delivery.source_from;
    input.overview.customers.details_until = input.delivery.source_until;
    expect(() => run(input)).toThrow("SOURCE_INTERVAL_INVALID");
  });
  it("rejects sub-millisecond future provenance", () => {
    const input = controlFixture();
    input.overview.assembled_at = "2026-10-24T02:00:00.000001Z";
    expect(() => run(input)).toThrow("READING_WINDOW_EXPIRED");
  });
  it("recent complete sources and concrete declarations still do not authorize operating cut", () => {
    const input = controlFixture();
    const from = "2026-10-23T18:00:00.000Z",
      until = "2026-10-23T18:10:00.000Z";
    Object.assign(input.overview.customers, {
      census_from: from,
      census_until: until,
      details_from: from,
      details_until: until,
    });
    Object.assign(input.delivery, {
      source_from: from,
      source_until: until,
      source_older_than_24h: false,
    });
    input.delivery.rows.forEach((r) => (r.source_at = from));
    expect(run(input).cuts).toMatchObject({
      review_inputs_recent: true,
      operating_cut_authorized: false,
    });
    input.delivery.rows[0].source_at = "2026-10-22T18:00:00.000Z";
    expect(() => run(input)).toThrow("DOCUMENT_DATE_OUTSIDE_ARCHIVE");
  });
});
