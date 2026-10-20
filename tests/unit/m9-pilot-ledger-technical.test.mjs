import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { digest } from "../../scripts/m9/acceleration.mjs";
import { pilotLedgerTechnicalRehearsal } from "../../scripts/m9/pilot-ledger-technical-rehearsal.mjs";
const location = "467765fe-d18e-43bb-be68-326adbf05ce1";
function fixture() {
  const o = { barcode: "0002396", observed_label: "ALMACENES\n2 PZA" },
    observationsRaw = JSON.stringify([o]);
  const row = {
    barcode: "0002396",
    variant_id: "6da4feb2-7146-4d4d-b865-6af14cc02a9b",
    product_id: "eae132eb-8111-418a-b30c-86a199934e62",
    observed_source_qty: "2",
    observation_sha256: digest(o),
    physical_qty: null,
    reserved_qty: null,
    available_qty: null,
    cost_cents: null,
    import_allowed: false,
  };
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
  return {
    observationsRaw,
    review: {
      version: "m9-sicar-pilot-evidence-1",
      inputs: {
        observations: createHash("sha256")
          .update(observationsRaw)
          .digest("hex"),
      },
      mode: "OFFLINE_READ_ONLY",
      production_allowed: false,
      inventory_import_allowed: false,
      activation_allowed: false,
      source_observation_is_not_physical_count: true,
      identity_sha256: digest([
        {
          barcode: row.barcode,
          variant_id: row.variant_id,
          product_id: row.product_id,
        },
      ]),
      rows: [row],
    },
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      captured_at: "2026-10-20T03:00:00Z",
      control: { enabled: true },
      proposed_location_id: location,
      locations: [{ id: location, type: "STORE", is_active: true }],
      rows: [
        {
          ...row,
          current: { cost_cents: null },
          location_id: location,
          stored_matches: true,
          review_matches: true,
          barcode_matches: true,
          is_active: true,
          unit_code: "PIECE",
          balance_present: false,
          qty: null,
          reserved_qty: null,
        },
      ],
      audit: Object.fromEntries(
        tables.map((t) => [
          t,
          { count: 0, md5: "d41d8cd98f00b204e9800998ecf8427e" },
        ]),
      ),
    },
  };
}
const run = (f) =>
  pilotLedgerTechnicalRehearsal(f.review, f.snapshot, f.observationsRaw);
it("uses the legitimate ledger only inside rollback, preserves the sale guard, and never certifies source reserves", () => {
  const sql = run(fixture());
  expect(sql).toMatch(/^-- TECHNICAL QA ONLY/);
  expect(sql).toMatch(/rollback;\n$/);
  expect(sql).not.toMatch(
    /\ncommit;|disable trigger|update app\.m9_rehearsal|set_config\('app.inventory_write'/i,
  );
  expect(sql).toContain("app.apply_movement");
  expect(sql).toContain("M9_TECHNICAL_ROLLBACK");
  expect(sql).toContain("TECHNICAL_REPLAY_DUPLICATED");
  expect(sql).toContain("M9_REVIEW_EXPIRED");
  expect(sql).toContain("'source_physical_stock_approved',false");
  expect(sql).toContain("0002396");
});
it.each([
  (f) => (f.review.activation_allowed = true),
  (f) => (f.review.production_allowed = true),
  (f) => (f.snapshot.project_id = "production"),
  (f) => (f.snapshot.control.enabled = false),
  (f) => (f.review.source_observation_is_not_physical_count = false),
])("rejects a broader or misleading scope", (change) => {
  const f = fixture();
  change(f);
  expect(() => run(f)).toThrow("TECHNICAL_STAGING_REVIEW_REQUIRED");
});
it.each([
  (f) => (f.snapshot.rows[0].qty = "1"),
  (f) => (f.snapshot.rows[0].unit_code = "PAIR"),
  (f) => (f.snapshot.rows[0].review_matches = false),
  (f) => (f.review.rows[0].physical_qty = "2"),
  (f) => (f.review.rows[0].reserved_qty = "0"),
])("rejects changed/approved quantities or nonempty baseline", (change) => {
  const f = fixture();
  f.snapshot.rows[0].balance_present = true;
  f.snapshot.rows[0].qty = "0";
  f.snapshot.rows[0].reserved_qty = "0";
  change(f);
  expect(() => run(f)).toThrow("NONEMPTY_OR_CHANGED_TECHNICAL_BASELINE");
});
it("requires all audit tables and cannot generate with an unsafe DO delimiter", () => {
  const f = fixture();
  delete f.snapshot.audit["public.sales"];
  expect(() => run(f)).toThrow("FULL_AUDIT_REQUIRED");
  const g = fixture();
  g.snapshot.rows[0].current.name = "$ledger$";
  expect(() => run(g)).toThrow("UNSAFE_DO_DELIMITER");
});

it("rejects a changed source or a quantity edited after the source crosscheck", () => {
  const f = fixture();
  f.observationsRaw += " ";
  expect(() => run(f)).toThrow("PINNED_SOURCE_OBSERVATIONS_REQUIRED");
  const g = fixture();
  g.review.rows[0].observed_source_qty = "200";
  expect(() => run(g)).toThrow("TECHNICAL_OBSERVED_QUANTITY_CHANGED");
});
