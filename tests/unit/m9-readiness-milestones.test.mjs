import { describe, expect, it } from "vitest";
import { evaluateMigrationMilestones } from "../../scripts/m9/readiness-milestones.mjs";
function fixture() {
  const sourceRows = ["0001", "2", "3"].map((barcode) => ({
    barcode,
    fields: { "clave1 *": barcode },
  }));
  const sourceMetadata = {
    protocol: "m9-renewed-sicar-read-only-1",
    sha256: "a".repeat(64),
    sicar_modified: false,
    inventory_import_allowed: false,
    woo_source_date: "2026-10-19",
    woo_full_export_renewed: false,
    scope: {
      all_departments: true,
      all_categories: true,
      location_confirmed: "La Piedad",
      warehouse: "default",
      tax_inclusive_prices: true,
      packages: false,
    },
  };
  const overview = {
    protocol: "m9-parallel-overview-1",
    read_only: true,
    operational_authorization: false,
    assembled_at: "2026-10-23T01:17:04.026022+00:00",
    catalog: {
      loaded_codes: 2,
      photo_evidence_rows: 3,
      photo_storage_rows: 2,
      review_rows_on_file: 1,
      review_window: { window_current: false },
    },
    inventory: { codes: 2, pending_fields: 6 },
    customers: {
      mapped_lines: 1,
      unmapped_lines: 2,
      unconfirmed_deliveries: 3,
      census_from: "2026-10-21T14:22:21.669Z",
      details_from: "2026-10-22T18:16:37.571Z",
      registered_legacy_accounts: 4,
      documents_reviewed: 2,
      accounts_reviewed: 2,
      historical_payments: 5,
    },
    woo: {
      worker_enabled: false,
      capture_enabled: false,
      stock_pilot_enabled: false,
      finance_enabled: false,
      native_rehearsals: 1,
      remote_connected_trials: 5,
    },
  };
  const measurement = {
    protocol: "m9-readiness-measurement-1",
    project_id: "zsezjtswqeijboezvado",
    observed_at: "2026-10-23T01:17:04.018512+00:00",
    overview,
    photos: {
      evidence_variants: 3,
      nonempty_evidence_variants: 2,
      empty_evidence_variants: 1,
      stored_nonempty_evidence_variants: 2,
      copied_variant_rows: 2,
    },
    inventory: {
      pilot_codes: 2,
      confirmed_fields: 0,
      required_fields: 6,
      fully_measured_codes: 0,
    },
    customers: {
      detail_lines: 3,
      raw_mapped_lines: 1,
      raw_unmapped_lines: 2,
      confirmed_delivery_lines: 0,
      sidecar_live_exact: 1,
      sidecar_exact_on_previously_unmapped: 1,
      sidecar_operational_permissions: 0,
    },
    finance: {
      web_events: 0,
      web_enabled: false,
      native_test_rehearsals: 1,
      legacy_test_ledger_rows: 7,
      legacy_test_ledger_net_cents: 1191000,
      native_customer_credit_ledger_rows: 0,
      native_customer_credit_ledger_net_cents: 0,
    },
    audit: { app_public_tables: 175 },
  };
  const required = {
    "app.m9_rows": 2,
    "app.web_variant_photo_evidence": 3,
    "app.web_variant_photo_storage": 2,
    "app.m9_web_settlement_events": 0,
    "app.m9_legacy_finance_ledger": 7,
    "public.customer_credit_ledger": 0,
  };
  const closureAudit = Object.entries(required).map(([name, rows]) => ({
    name,
    rows,
    md5: "a".repeat(32),
  }));
  for (let i = closureAudit.length; i < 175; i++)
    closureAudit.push({
      name: `app.fixture_${i}`,
      rows: 0,
      md5: "a".repeat(32),
    });
  return {
    sourceRows,
    stagingCodes: ["0001", "2"],
    sourceMetadata,
    coverage: {
      loaded_codes: 2,
      source_codes: 3,
      source_in_staging: 2,
      staging_not_in_source: 0,
      source_not_in_staging: 1,
      coverage_percent: 66.67,
      scope: "catalog_code_presence_only_not_global_or_operational_readiness",
    },
    measurement,
    closureAudit,
    closureVerification: {
      protocol: "m9-block3-offline-verification-1",
      status: "EVIDENCE_CHECKS_PASSED_NOT_OPERATIONAL_AUTHORIZATION",
      operational_authorization: false,
      unresolved: 0,
      checks: [{ name: "closure", status: "PASS" }],
    },
    connector: {
      protocol: "m9-sandbox-code-gap-evidence-1",
      test_origin: "https://salmon-nightingale-251188.hostingersite.com",
      global_outbound_blocked: true,
      available_gateways_forced_empty: true,
      public_checkout_blocked: true,
      financial_reader_scope: "CANCELLED_SYNTHETIC_ONLY",
      provider_receiver_enabled: false,
      accredited_providers: 0,
      native_money_mode: "SYNTHETIC_TEST_ONLY",
    },
    asOf: "2026-10-23T01:20:00.000Z",
  };
}
const metric = (r, id) =>
  r.milestones.flatMap((m) => m.metrics).find((x) => x.id === id);
describe("readiness measurements preserve scopes", () => {
  it("measures compatible denominators without global percentage, ETA or operation authorization", () => {
    const f = fixture(),
      original = JSON.stringify(f),
      r = evaluateMigrationMilestones(f);
    expect(r.global_percent).toBeNull();
    expect(r.estimated_delivery_at).toBeNull();
    expect(r.operational_authorization).toBe(false);
    expect(metric(r, "source_code_presence")).toMatchObject({
      numerator: 2,
      denominator: 3,
      percent_in_this_scope: 66.67,
    });
    expect(metric(r, "pilot_physical_fields")).toMatchObject({
      numerator: 0,
      denominator: 6,
    });
    expect(metric(r, "archived_line_identity")).toMatchObject({
      numerator: 2,
      denominator: 3,
    });
    expect(JSON.stringify(f)).toBe(original);
    expect(evaluateMigrationMilestones(f)).toEqual(r);
    expect(r.milestones.every((m) => m.blockers.length > 0)).toBe(true);
  });
  it("does not convert unknown all-Woo coverage or financial eligibility into zero", () => {
    const r = evaluateMigrationMilestones(fixture());
    for (const id of ["all_woo_photo_completion", "eligible_debt_openings"])
      expect(metric(r, id)).toMatchObject({
        numerator: null,
        denominator: null,
        percent_in_this_scope: null,
      });
    expect(metric(r, "registered_accounts").denominator).toBeNull();
  });
  it("complete known-photo subset is not all Woo or publication approval", () => {
    const r = evaluateMigrationMilestones(fixture()),
      m = r.milestones.find((x) => x.id === "photos");
    expect(metric(r, "known_photo_copy")).toMatchObject({
      numerator: 2,
      denominator: 2,
      percent_in_this_scope: 100,
      operational_authorization: false,
    });
    expect(m.blockers).toContain("WOO_FULL_EXPORT_HISTORICAL");
    expect(metric(r, "all_woo_photo_completion").denominator).toBeNull();
  });
  it("does not count QA trials or native receipts as authentic payment cycles", () => {
    const r = evaluateMigrationMilestones(fixture());
    expect(metric(r, "first_authentic_cycle")).toMatchObject({
      numerator: 0,
      denominator: 1,
    });
    expect(
      r.milestones.find((x) => x.id === "woo_orders_payments").observations[0]
        .value,
    ).toBe(5);
    expect(r.observations.census_older_than_24h_at_review).toBe(true);
  });
  it("keeps delivery and financial indicators separate", () => {
    const r = evaluateMigrationMilestones(fixture());
    expect(metric(r, "archived_delivery_confirmed").numerator).toBe(0);
    expect(metric(r, "eligible_debt_openings").numerator).toBeNull();
    expect(
      r.milestones
        .find((x) => x.id === "customers")
        .observations.find((x) => x.label === "Libro nativo de crédito").value,
    ).toBe(0);
  });
  it.each([
    (f) => f.stagingCodes.push("0001"),
    (f) => f.sourceRows.push(f.sourceRows[0]),
    (f) => (f.stagingCodes[0] = "1"),
    (f) => (f.sourceRows[0].fields["clave1 *"] = "1"),
    (f) => (f.coverage.source_in_staging = 3),
    (f) => (f.coverage.coverage_percent = 67),
    (f) => (f.measurement.photos.stored_nonempty_evidence_variants = 3),
    (f) => (f.measurement.photos.empty_evidence_variants = 3),
    (f) => (f.measurement.inventory.required_fields = 36),
    (f) => (f.measurement.inventory.fully_measured_codes = 1),
    (f) => (f.measurement.customers.sidecar_exact_on_previously_unmapped = 3),
    (f) => (f.measurement.customers.sidecar_operational_permissions = 1),
    (f) => (f.measurement.customers.raw_mapped_lines = null),
    (f) => (f.measurement.photos.copied_variant_rows = NaN),
    (f) => (f.measurement.inventory.pilot_codes = Infinity),
    (f) => (f.measurement.overview.woo.capture_enabled = null),
    (f) => (f.measurement.overview.woo.finance_enabled = true),
    (f) => (f.measurement.finance.web_enabled = true),
    (f) => (f.measurement.project_id = "production"),
    (f) => (f.measurement.overview.operational_authorization = true),
    (f) => (f.closureVerification.unresolved = 1),
    (f) => (f.closureVerification.checks[0].status = "MISSING"),
    (f) => f.closureAudit.pop(),
    (f) => (f.closureAudit[0].rows = 7),
    (f) => (f.connector.provider_receiver_enabled = true),
    (f) => (f.connector.accredited_providers = 1),
    (f) => (f.asOf = "2026-10-23T02:20:00.000Z"),
    (f) => (f.asOf = "2026-10-23T01:10:00.000Z"),
  ])(
    "fails closed for incompatible, stale or falsely authorized evidence %#",
    (mutate) => {
      const f = fixture();
      mutate(f);
      expect(() => evaluateMigrationMilestones(f)).toThrow();
    },
  );
  it("retains frozen closure and accepts a distinct later measurement audit", () => {
    const f = fixture();
    f.measurementAudit = structuredClone(f.closureAudit);
    f.measurementAudit.find((x) => x.name === "app.m9_rows").rows = 3;
    f.stagingCodes.push("3");
    Object.assign(f.coverage, {
      loaded_codes: 3,
      source_in_staging: 3,
      source_not_in_staging: 0,
      coverage_percent: 100,
    });
    f.measurement.overview.catalog.loaded_codes = 3;
    const r = evaluateMigrationMilestones(f);
    expect(metric(r, "source_code_presence").numerator).toBe(3);
    expect(f.closureAudit[0].rows).toBe(2);
    expect(
      r.observations.closed_block_is_historical_not_latest_data_approval,
    ).toBe(true);
    expect(r.operational_authorization).toBe(false);
  });
  it("does not manufacture 100% when a known-photo denominator is empty", () => {
    const f = fixture();
    for (const k of Object.keys(f.measurement.photos))
      f.measurement.photos[k] = 0;
    f.measurement.overview.catalog.photo_storage_rows = 0;
    f.measurement.overview.catalog.photo_evidence_rows = 0;
    f.closureAudit.find(
      (x) => x.name === "app.web_variant_photo_evidence",
    ).rows = 0;
    f.closureAudit.find(
      (x) => x.name === "app.web_variant_photo_storage",
    ).rows = 0;
    expect(
      metric(evaluateMigrationMilestones(f), "known_photo_copy")
        .percent_in_this_scope,
    ).toBeNull();
  });
  it("preserves unknown census date and requires renewal instead of setting age zero", () => {
    const f = fixture();
    f.measurement.overview.customers.census_from = null;
    const r = evaluateMigrationMilestones(f);
    expect(r.observations.census_older_than_24h_at_review).toBeNull();
    expect(r.milestones.find((x) => x.id === "customers").blockers).toContain(
      "CUSTOMER_CENSUS_NEEDS_RENEWAL",
    );
  });
});
