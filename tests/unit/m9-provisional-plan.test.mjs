import { describe, it, expect } from "vitest";
import { provisionalPlan } from "../../scripts/m9/provisional-plan.mjs";
const row = () => ({
  barcode: "0007",
  description: "MODELO27",
  classification: "DUPLICATE_WOO_BASE",
  product_id: null,
  candidate_product_ids: [12, 13],
  issues: [],
  commercial_checks: [],
  fields: {
    "clave1 *": "0007",
    "descripción *": "MODELO27",
    departamento: "CABALLERO",
    categoria: "BOTAS",
    precio1: "740",
    unidad: "PIEZA",
    "(s/n) inventariable": "s",
    "(s/n) mostrar en ventas": "s",
    "(s/n) granel": "n",
    "(s/n) receta": "n",
    "(s/n) lotes": "n",
  },
});
const args = (r) => ({
  rows: [r],
  snapshot: { codes: [], names: [] },
  taxonomy: { paths: [] },
  sourceSha: "a".repeat(64),
  authorization: "Emmanuel autoriza provisional staging",
  date: "2026-10-18",
});
describe("M9 independent provisional identity", () => {
  it("preserves barcode and full description without inferring 27 or linking Woo", () => {
    const p = provisionalPlan(args(row())),
      r = p.batches.batches[0].packet.rows[0];
    expect(r.barcode).toBe("0007");
    expect(r.description).toBe("MODELO27");
    expect(r.attributes).toEqual({});
    expect(r.woo_variation_id).toBeNull();
    expect(r.cost_cents).toBeNull();
    expect(p.sourceEvidence[0].candidate_woo_ids).toEqual([12, 13]);
    expect(p.sourceEvidence[0].web_release).toBe(false);
  });
  it.each(["PRICE", "TAXONOMY", "DISPLAY", "UNIT", "BULK", "RECIPE", "LOT"])(
    "retains %s outside import",
    (type) => {
      const r = row();
      if (type === "PRICE") r.fields.precio1 = "";
      if (type === "TAXONOMY") r.fields.categoria = "C1";
      if (type === "DISPLAY") r.display_only = true;
      if (type === "UNIT") r.fields.unidad = "KILO";
      if (type === "BULK") r.fields["(s/n) granel"] = "s";
      if (type === "RECIPE") r.fields["(s/n) receta"] = "s";
      if (type === "LOT") r.fields["(s/n) lotes"] = "s";
      expect(provisionalPlan(args(r)).summary.eligible_codes).toBe(0);
    },
  );
  it("does not create a second variant for an already loaded barcode", () => {
    const a = args(row());
    a.snapshot.codes.push({ barcode: "0007" });
    expect(provisionalPlan(a).summary.eligible_codes).toBe(0);
  });
  it("does not reactivate or rename a conflicting destination category", () => {
    const a = args(row());
    a.snapshot.categories = [{ name: "BOTAS", is_active: false }];
    expect(provisionalPlan(a).held[0].reasons).toContain("CATEGORY_CONFLICT");
  });
  it("rejects a changed or duplicate Clave 1", () => {
    const a = args(row());
    a.rows[0].barcode = "7";
    expect(() => provisionalPlan(a)).toThrow("SOURCE_LITERAL_IDENTITY_CHANGED");
    const b = args(row());
    b.rows.push(row());
    expect(() => provisionalPlan(b)).toThrow("SOURCE_LITERAL_IDENTITY_CHANGED");
  });
});
