import { describe, expect, it } from "vitest";
import {
  catalogoPreciosCortePlan,
  publicPriceCents,
} from "../../scripts/m9/catalogo-precios-corte-plan.mjs";

const date = "2026-10-22T23:50:03.193Z";
function fixture() {
  const fields = {
    "clave1 *": "0000123",
    "descripción *": "MODELO T.28",
    departamento: "CABALLERO",
    categoria: "PANTALONES",
    precio1: "980",
    precio2: "0",
    precio3: "0",
    precio4: "0",
    mayoreo2: "0",
    mayoreo3: "0",
    mayoreo4: "0",
    costo: "0",
    existencia: "3",
    unidad: "PIEZA",
    "(s/n) mostrar en ventas": "s",
    "(s/n) inventariable": "s",
    "(s/n) precio con impuestos": "s",
    "(s/n) granel": "n",
    "(s/n) receta": "n",
    "(s/n) lotes": "n",
  };
  const row = {
    barcode: "0000123",
    description: "MODELO T.28",
    fields,
    issues: [],
    commercial_checks: [],
    display_only: null,
    product_id: null,
    variation_id: null,
    candidate_product_ids: [],
    candidate_variation_ids: [],
  };
  const after = structuredClone(row);
  after.fields.precio1 = "1150";
  const source = {
    attributes: {},
    barcode: row.barcode,
    cost_cents: null,
    department: "CABALLERO",
    description: row.description,
    family_key: "prov-literal",
    price_cents: 98000,
    product_name: "MODELO T.28 [SICAR 0000123]",
    section: "PANTALONES",
    woo_variation_id: null,
  };
  const variant = "11111111-1111-4111-8111-111111111111";
  const live = {
    barcode: row.barcode,
    variant_id: variant,
    product_id: "22222222-2222-4222-8222-222222222222",
    source_sha256: "a".repeat(64),
    source_row: source,
    current_row: structuredClone(source),
    barcode_bindings: 1,
    barcode_variant_id: variant,
    price_cents: 98000,
    cost_cents: null,
    woo_product_id: null,
    woo_variation_id: null,
  };
  return {
    before: [row],
    after: [after],
    snapshot: {
      version: "m9-catalog-price-snapshot-1",
      project_id: "zsezjtswqeijboezvado",
      observed_at: date,
      mode: "READ_ONLY_SELECT",
      rows: [live],
    },
  };
}
const plan = (f, asOf = date) =>
  catalogoPreciosCortePlan(f.before, f.after, f.snapshot, asOf);
const held = (f, reason) => {
  const p = plan(f);
  expect(p.summary.public_price_only_candidates).toBe(0);
  expect(p.records[0].reasons).toContain(reason);
};
describe("read-only public price cut plan", () => {
  it("pins exact literal code, UUID and full M9 state without authorizing writes", () => {
    const f = fixture(),
      raw = JSON.stringify(f),
      p = plan(f);
    expect(p.summary.public_price_only_candidates).toBe(1);
    expect(p.records[0]).toMatchObject({
      barcode: "0000123",
      previous_public_cents: 98000,
      proposed_public_cents: 115000,
      apply_allowed: false,
      owner_approval: null,
    });
    expect(p.records[0].preconditions.variant_id).toBe(
      f.snapshot.rows[0].variant_id,
    );
    expect(p.records[0].preconditions_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(p.policy).toMatchObject({
      inventory_operations: 0,
      cost_operations: 0,
      woo_operations: 0,
    });
    expect(JSON.stringify(f)).toBe(raw);
    expect(plan(f)).toEqual(p);
  });
  it.each([
    null,
    undefined,
    12,
    -1,
    NaN,
    Infinity,
    "",
    "0",
    "-3",
    "1e3",
    "1,150",
    " 980",
    "1.001",
    "999999999999",
    "0x12",
  ])("rejects invalid or ambiguous price %s", (x) => {
    expect(publicPriceCents(x)).toBeNull();
  });
  it("uses decimal integer arithmetic without floating-point rounding", () => {
    expect(publicPriceCents("2190.01")).toBe(219001);
    expect(publicPriceCents("0001.1")).toBe(110);
  });
  it("retains a source-only price change when Woo suggests a parent without a variant", () => {
    const f = fixture();
    f.before[0].candidate_product_ids = [20470];
    f.after[0].candidate_product_ids = [20470];
    const p = plan(f);
    expect(p.summary.public_price_only_source_changes).toBe(1);
    expect(p.summary.public_price_baseline_exact_but_woo_held).toBe(1);
    expect(p.summary.public_price_only_candidates).toBe(0);
    expect(p.records[0].reasons).toEqual([
      "WOO_CONTEXT_REQUIRES_SEPARATE_REVIEW",
    ]);
  });
  it.each([
    ["SOURCE_INCOMPLETE_OR_BLOCKED", (f) => delete f.after[0].fields.unidad],
    [
      "SOURCE_INCOMPLETE_OR_BLOCKED",
      (f) => (f.after[0].fields["clave1 *"] = "123"),
    ],
    [
      "SOURCE_INCOMPLETE_OR_BLOCKED",
      (f) => f.after[0].issues.push("AMBIGUOUS"),
    ],
    [
      "SOURCE_INCOMPLETE_OR_BLOCKED",
      (f) => (f.after[0].fields["(s/n) precio con impuestos"] = "n"),
    ],
    ["SECONDARY_PRICES_UNDEFINED", (f) => (f.after[0].fields.precio2 = "500")],
    [
      "DESCRIPTION_IDENTITY_OR_OTHER_CATALOG_CHANGE",
      (f) => {
        f.after[0].description = "MODELO OTRO";
        f.after[0].fields["descripción *"] = "MODELO OTRO";
      },
    ],
    [
      "DESCRIPTION_IDENTITY_OR_OTHER_CATALOG_CHANGE",
      (f) => (f.after[0].fields.costo = "900"),
    ],
    [
      "DESCRIPTION_IDENTITY_OR_OTHER_CATALOG_CHANGE",
      (f) => (f.after[0].fields.departamento = "DAMA"),
    ],
    [
      "WOO_CONTEXT_REQUIRES_SEPARATE_REVIEW",
      (f) => (f.after[0].candidate_product_ids = [12]),
    ],
    [
      "WOO_CONTEXT_REQUIRES_SEPARATE_REVIEW",
      (f) => (f.snapshot.rows[0].woo_product_id = 12),
    ],
    [
      "M9_PROJECTION_DRIFT_OR_INCOMPLETE",
      (f) => (f.snapshot.rows[0].current_row.product_name += " edited"),
    ],
    [
      "M9_PROJECTION_DRIFT_OR_INCOMPLETE",
      (f) => (f.snapshot.rows[0].current_row = null),
    ],
    [
      "M9_PROJECTION_DRIFT_OR_INCOMPLETE",
      (f) => (f.snapshot.rows[0].source_row.unexpected = true),
    ],
    [
      "CODE_UUID_BINDING_INVALID",
      (f) => (f.snapshot.rows[0].barcode_bindings = 2),
    ],
    [
      "CODE_UUID_BINDING_INVALID",
      (f) => (f.snapshot.rows[0].variant_id = "malformed"),
    ],
    [
      "CODE_UUID_BINDING_INVALID",
      (f) => (f.snapshot.rows[0].source_sha256 = null),
    ],
    [
      "CODE_UUID_BINDING_INVALID",
      (f) =>
        (f.snapshot.rows[0].barcode_variant_id =
          "22222222-2222-4222-8222-222222222222"),
    ],
    [
      "BASELINE_IDENTITY_PRICE_OR_COST_MISMATCH",
      (f) => (f.snapshot.rows[0].price_cents = 115000),
    ],
    [
      "BASELINE_IDENTITY_PRICE_OR_COST_MISMATCH",
      (f) => (f.snapshot.rows[0].cost_cents = 0),
    ],
    [
      "BASELINE_IDENTITY_PRICE_OR_COST_MISMATCH",
      (f) => (f.snapshot.rows[0].source_row.description = "OTHER"),
    ],
    [
      "INCOMPLETE_STAGING_SNAPSHOT",
      (f) => delete f.snapshot.rows[0].woo_product_id,
    ],
    [
      "DUPLICATE_SOURCE_CODE",
      (f) => f.before.push(structuredClone(f.before[0])),
    ],
    ["MISSING_OR_DUPLICATE_STAGING_ROW", (f) => (f.snapshot.rows = [])],
    [
      "MISSING_OR_DUPLICATE_STAGING_ROW",
      (f) => f.snapshot.rows.push(structuredClone(f.snapshot.rows[0])),
    ],
  ])("holds %s", (reason, mutate) => {
    const f = fixture();
    mutate(f);
    held(f, reason);
  });
  it("does not normalize padded codes or infer size groupings", () => {
    const f = fixture();
    f.snapshot.rows[0].barcode = "123";
    held(f, "MISSING_OR_DUPLICATE_STAGING_ROW");
  });
  it("keeps stock observation separate even on a public-price candidate", () => {
    const f = fixture();
    f.after[0].fields.existencia = "0";
    const p = plan(f);
    expect(p.summary.public_price_only_candidates).toBe(1);
    expect(p.records[0].observed_stock_change_excluded).toBe(true);
    expect(p.records[0].preconditions).not.toHaveProperty("existencia");
  });
  it("excludes new, removed, unchanged and stock-only codes from updates", () => {
    const f = fixture();
    f.after[0].fields.precio1 = "980";
    f.after[0].fields.existencia = "2";
    const p = plan(f);
    expect(p.records).toEqual([]);
    expect(p.stock_only_codes_excluded).toEqual(["0000123"]);
    f.after = [];
    expect(plan(f).removed_codes_excluded).toEqual(["0000123"]);
    f.before = [];
    f.after = fixture().after;
    expect(plan(f).added_codes_excluded).toEqual(["0000123"]);
  });
  it("retains price-secondary-only changes without a public proposal", () => {
    const f = fixture();
    f.after[0].fields.precio1 = "980";
    f.after[0].fields.precio3 = "800";
    held(f, "NO_PUBLIC_PRICE_CHANGE");
  });
  it.each(["2026-10-23T00:06:03.193Z", "2026-10-22T23:49:03.193Z"])(
    "holds stale/future snapshot at %s",
    (asOf) => {
      const p = plan(fixture(), asOf);
      expect(p.snapshot_stale).toBe(true);
      expect(p.summary.public_price_only_candidates).toBe(0);
    },
  );
  it.each([
    "2026-10-22",
    "2026-02-31T23:50:03.193Z",
    "2026-10-22T23:50:03Z",
    null,
  ])("rejects noncanonical review date %s", (date) => {
    expect(() => plan(fixture(), date)).toThrow();
  });
  it("rejects wrong project, mode or nonfinite JSON without interpretation", () => {
    const f = fixture();
    f.snapshot.project_id = "production";
    expect(() => plan(f)).toThrow();
    f.snapshot = fixture().snapshot;
    f.snapshot.rows[0].price_cents = NaN;
    expect(() => plan(f)).toThrow("NON_JSON_VALUE");
  });
});
