import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { digest } from "../../scripts/m9/acceleration.mjs";
import {
  pilotStockPlan,
  pilotStockPreflightSQL,
  preparePilotStock,
} from "../../scripts/m9/prepare-pilot-stock.mjs";

const at = "2026-10-20T02:30:00Z",
  project = "zsezjtswqeijboezvado",
  loc = "467765fe-d18e-43bb-be68-326adbf05ce1";
function fixture() {
  const p = {
    barcode: "0002396",
    variant_id: "6da4feb2-7146-4d4d-b865-6af14cc02a9b",
    product_id: "eae132eb-8111-418a-b30c-86a199934e62",
    product_name: "Sombrero <script>",
    source_description: "BASE59",
    department: "UNISEX",
    section: "SOMBRERO",
    attributes: { TALLA: "59" },
    public_price_cents: 219000,
    cost_cents: null,
    woo_product_id: 19746,
    woo_variation_id: 19815,
    source_warehouse: "default",
    source_stock_observed: "999",
    source_stock_is_importable: false,
  };
  const current = {
    barcode: p.barcode,
    description: p.source_description,
    department: p.department,
    section: p.section,
    attributes: p.attributes,
    price_cents: p.public_price_cents,
    cost_cents: null,
    product_name: p.product_name,
    woo_product_id: p.woo_product_id,
    woo_variation_id: p.woo_variation_id,
  };
  const renewal = {
    version: "m9-renewed-pilot-1",
    project_id: project,
    production_allowed: false,
    activation_allowed: false,
    inventory_import_allowed: false,
    pilot: {
      rows: [p],
      identity_sha256: digest([
        {
          barcode: p.barcode,
          variant_id: p.variant_id,
          product_id: p.product_id,
        },
      ]),
    },
  };
  const snapshot = {
    project_id: project,
    control: { enabled: true },
    captured_at: at,
    proposed_location_id: loc,
    locations: [{ id: loc, name: "La Piedad", type: "STORE", is_active: true }],
    rows: [
      {
        barcode: p.barcode,
        variant_id: p.variant_id,
        product_id: p.product_id,
        current,
        is_active: true,
        stored_matches: true,
        review_matches: true,
        barcode_matches: true,
        unit_code: "PIECE",
        location_id: loc,
        balance_present: false,
        qty: null,
        reserved_qty: null,
        movement_count: 8,
      },
    ],
  };
  return { renewal, snapshot };
}
function completed(f) {
  const plan = pilotStockPlan(f.renewal, f.snapshot, null, at),
    e = plan.evidence_template;
  e.warehouse = {
    ...e.warehouse,
    source_facility: "QA LOCAL · tienda",
    scope: "SINGLE_STORE",
    quantity_meaning: "PHYSICAL_INCLUDES_RESERVED",
    confirmed_by: "QA fixture",
    confirmed_at: at,
    evidence_sha256: "a".repeat(64),
  };
  e.stock = {
    ...e.stock,
    source_facility: e.warehouse.source_facility,
    captured_at: at,
    confirmed_by: "QA fixture",
    evidence_sha256: "b".repeat(64),
    includes_reservations: true,
    rows: [{ barcode: "0002396", physical_qty: "2", reserved_qty: "0" }],
  };
  return e;
}
it("preserves literal code/history, unknown source quantities, and absent destination rows", () => {
  const f = fixture(),
    p = pilotStockPlan(f.renewal, f.snapshot, null, at);
  expect(p.rows[0]).toMatchObject({
    barcode: "0002396",
    physical_qty: null,
    reserved_qty: null,
    expected_qty: null,
    balance_present: false,
    historical_movements: 8,
    cost_cents: null,
  });
  expect(p.inventory_import_allowed).toBe(false);
  expect(p.blockers).toContain("WAREHOUSE_MAPPING_UNCONFIRMED");
  expect(p.rows[0].issues).toContain("EXPLICIT_WHOLE_QUANTITIES_REQUIRED");
  expect(JSON.stringify(p)).not.toContain('"999"');
});
it("marks evidence complete without granting stock writes or sale activation", () => {
  const f = fixture(),
    p = pilotStockPlan(f.renewal, f.snapshot, completed(f), at);
  expect(p.readiness).toBe("EVIDENCE_COMPLETE_REHEARSAL_STILL_REQUIRED");
  expect(p.rows[0].available_qty).toBe("2");
  expect(p.activation_allowed).toBe(false);
  expect(p.inventory_import_allowed).toBe(false);
  expect(p.batch_reference).toBe(
    pilotStockPlan(f.renewal, f.snapshot, completed(f), at).batch_reference,
  );
});
it("accepts an explicitly evidenced zero and does not turn null into zero", () => {
  const f = fixture(),
    e = completed(f);
  e.stock.rows[0].physical_qty = "0";
  expect(
    pilotStockPlan(f.renewal, f.snapshot, e, at).rows[0].available_qty,
  ).toBe("0");
  e.stock.rows[0].physical_qty = null;
  expect(
    pilotStockPlan(f.renewal, f.snapshot, e, at).rows[0].available_qty,
  ).toBe(null);
});
it.each(["-1", "1.5", "1e2", " 2", "2 ", "NaN", "1000000000", 2, undefined])(
  "retains invalid or fractional evidence %s",
  (v) => {
    const f = fixture(),
      e = completed(f);
    e.stock.rows[0].physical_qty = v;
    expect(
      pilotStockPlan(f.renewal, f.snapshot, e, at).rows[0].issues,
    ).toContain("EXPLICIT_WHOLE_QUANTITIES_REQUIRED");
  },
);
it("retains real reservations for their own migration plan", () => {
  const f = fixture(),
    e = completed(f);
  e.stock.rows[0].reserved_qty = "1";
  expect(pilotStockPlan(f.renewal, f.snapshot, e, at).rows[0].issues).toContain(
    "RESERVATION_MIGRATION_PLAN_REQUIRED",
  );
  e.stock.rows[0].reserved_qty = "3";
  expect(pilotStockPlan(f.renewal, f.snapshot, e, at).rows[0].issues).toContain(
    "RESERVED_EXCEEDS_PHYSICAL",
  );
});
it.each([
  (e) => (e.warehouse.scope = "MULTIPLE_STORES"),
  (e) => (e.warehouse.quantity_meaning = "AVAILABLE"),
  (e) => (e.warehouse.target_location_id = "other"),
  (e) => (e.warehouse.confirmed_by = null),
  (e) => (e.warehouse.evidence_sha256 = null),
  (e) => (e.warehouse.confirmed_at = "2026-10-18T00:00:00Z"),
  (e) => (e.warehouse.confirmed_at = "2026-10-21T00:00:00Z"),
])("requires explicit single-store physical mapping", (change) => {
  const f = fixture(),
    e = completed(f);
  change(e);
  expect(pilotStockPlan(f.renewal, f.snapshot, e, at).blockers).toContain(
    "WAREHOUSE_MAPPING_UNCONFIRMED",
  );
});
it.each([
  (e) => (e.stock.source_warehouse = "other"),
  (e) => (e.stock.source_facility = "other"),
  (e) => (e.stock.includes_reservations = null),
  (e) => (e.stock.evidence_sha256 = ""),
  (e) => (e.stock.captured_at = "2026-10-18T00:00:00Z"),
])("pins scope, time and reservation evidence", (change) => {
  const f = fixture(),
    e = completed(f);
  change(e);
  expect(pilotStockPlan(f.renewal, f.snapshot, e, at).blockers).toContain(
    "STOCK_EVIDENCE_INCOMPLETE_OR_STALE",
  );
});
it("does not overwrite nonzero destination balances", () => {
  const f = fixture();
  Object.assign(f.snapshot.rows[0], {
    balance_present: true,
    qty: "1.000",
    reserved_qty: "0",
  });
  expect(
    pilotStockPlan(f.renewal, f.snapshot, completed(f), at).rows[0].issues,
  ).toContain("NONZERO_DESTINATION_REQUIRES_SEPARATE_DELTA_PLAN");
});
it("requires fresh destination and explicit timezone", () => {
  const f = fixture();
  f.snapshot.captured_at = "2026-10-19T00:00:00Z";
  expect(pilotStockPlan(f.renewal, f.snapshot, null, at).blockers).toContain(
    "DESTINATION_SNAPSHOT_STALE",
  );
  expect(() =>
    pilotStockPlan(f.renewal, f.snapshot, null, "2026-10-20"),
  ).toThrow("GUARDED_RENEWED_PILOT_REQUIRED");
});
it.each([
  (f) => (f.renewal.project_id = "production"),
  (f) => (f.snapshot.project_id = "production"),
  (f) => (f.snapshot.control.enabled = false),
  (f) => (f.renewal.inventory_import_allowed = true),
])("rejects other projects or expanded authorization", (change) => {
  const f = fixture();
  change(f);
  expect(() => pilotStockPlan(f.renewal, f.snapshot, null, at)).toThrow(
    "GUARDED_RENEWED_PILOT_REQUIRED",
  );
});
it.each([
  (f) => (f.snapshot.rows[0].variant_id = "different"),
  (f) => (f.snapshot.rows[0].barcode_matches = false),
  (f) => (f.snapshot.rows[0].unit_code = "PAIR"),
  (f) => (f.snapshot.rows[0].is_active = false),
])("rejects changed destination identity/review/unit", (change) => {
  const f = fixture();
  change(f);
  expect(() => pilotStockPlan(f.renewal, f.snapshot, null, at)).toThrow(
    "LIVE_IDENTITY_OR_REVIEW_CHANGED",
  );
});
it("rejects price/cost changes and non-store targets", () => {
  const f = fixture();
  f.snapshot.rows[0].current.cost_cents = 0;
  expect(() => pilotStockPlan(f.renewal, f.snapshot, null, at)).toThrow(
    "PILOT_CATALOG_CHANGED",
  );
  f.snapshot.locations[0].type = "TRANSIT";
  expect(() => pilotStockPlan(f.renewal, f.snapshot, null, at)).toThrow(
    "ACTIVE_STORE_REQUIRED",
  );
});
it("rejects extra/duplicate stock rows and never coerces numeric barcodes", () => {
  const f = fixture(),
    e = completed(f);
  e.stock.rows.push({ ...e.stock.rows[0] });
  expect(() => pilotStockPlan(f.renewal, f.snapshot, e, at)).toThrow(
    "EXTRA_DUPLICATE_OR_NONLITERAL_STOCK_CODE",
  );
  e.stock.rows = [{ barcode: 2396 }];
  expect(() => pilotStockPlan(f.renewal, f.snapshot, e, at)).toThrow(
    "EXTRA_DUPLICATE_OR_NONLITERAL_STOCK_CODE",
  );
  e.stock.rows = [];
  expect(pilotStockPlan(f.renewal, f.snapshot, e, at).rows[0].issues).toContain(
    "EXPLICIT_WHOLE_QUANTITIES_REQUIRED",
  );
});
it("generates only a read-only rollback preflight, never an import", () => {
  const f = fixture(),
    p = pilotStockPlan(f.renewal, f.snapshot, null, at),
    sql = pilotStockPreflightSQL(p, f.snapshot);
  expect(sql).toMatch(/^begin isolation level repeatable read read only;/);
  expect(sql).toMatch(/rollback;\n$/);
  expect(sql).not.toMatch(
    /\b(insert|update|delete|truncate|commit|apply_movement|apply_inventory_adjustment)\b/i,
  );
  expect(sql).toContain("STOCK_BASELINE_CHANGED");
  expect(sql).toContain("BLOCKED_MISSING_OR_CHANGED_EVIDENCE");
  expect(sql).toContain("0002396");
  p.rows = [];
  expect(() => pilotStockPreflightSQL(p, f.snapshot)).toThrow(
    "READ_ONLY_STAGING_PLAN_REQUIRED",
  );
});
it("rejects mismatched SQL scope and unsafe DO delimiters", () => {
  const f = fixture(),
    p = pilotStockPlan(f.renewal, f.snapshot, null, at);
  p.location.name = "$stock$";
  expect(() => pilotStockPreflightSQL(p, f.snapshot)).toThrow(
    "EXACT_PREFLIGHT_SCOPE_REQUIRED",
  );
  p.location = f.snapshot.locations[0];
  f.snapshot.rows[0].current.product_name = "$stock$";
  expect(() => pilotStockPreflightSQL(p, f.snapshot)).toThrow(
    "UNSAFE_DO_DELIMITER",
  );
});
it("reproduces pinned CLI output, escapes HTML, rejects changed bytes and existing output", async () => {
  const f = fixture(),
    root = await mkdtemp(join(tmpdir(), "m9-pilot-stock-"));
  try {
    const inputs = {};
    for (const [name, value] of Object.entries(f)) {
      const raw = JSON.stringify(value);
      await writeFile(join(root, name + ".json"), raw);
      inputs[name] = {
        path: name + ".json",
        sha256: createHash("sha256").update(raw).digest("hex"),
      };
    }
    await writeFile(
      join(root, "config.json"),
      JSON.stringify({ assessment_at: at, inputs }),
    );
    await preparePilotStock(join(root, "config.json"), join(root, "one"));
    await preparePilotStock(join(root, "config.json"), join(root, "two"));
    expect(await readFile(join(root, "one/sha256.json"), "utf8")).toBe(
      await readFile(join(root, "two/sha256.json"), "utf8"),
    );
    const html = await readFile(join(root, "one/reporte.html"), "utf8");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    await expect(
      preparePilotStock(join(root, "config.json"), join(root, "one")),
    ).rejects.toThrow();
    await writeFile(join(root, "snapshot.json"), "{}");
    await expect(
      preparePilotStock(join(root, "config.json"), join(root, "three")),
    ).rejects.toThrow("INPUT_CHANGED:snapshot");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
