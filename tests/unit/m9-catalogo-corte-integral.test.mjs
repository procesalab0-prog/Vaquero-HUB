import { describe, it, expect } from "vitest";
import { digest } from "../../scripts/m9/acceleration.mjs";
import { auditCompleteCatalogEvidence } from "../../scripts/m9/audit-catalogo-corte-integral.mjs";
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
function fixture() {
  const source = Array.from({ length: 16396 }, (_, i) => {
    const barcode = String(i + 1).padStart(5, "0"),
      description = "SYNTHETIC" + barcode;
    return {
      barcode,
      description,
      product_id: null,
      variation_id: null,
      attributes: [],
      fields: {
        "clave1 *": barcode,
        "descripción *": description,
        departamento: "UNISEX",
        categoria: "SYNTHETIC",
        precio1: "10",
      },
    };
  });
  const rows = source.slice(0, 15961).map((s, i) => {
    const current = {
      barcode: s.barcode,
      description: s.description,
      department: "UNISEX",
      section: "SYNTHETIC",
      price_cents: 1000,
      cost_cents: null,
      attributes: {},
      woo_variation_id: null,
    };
    return {
      barcode: s.barcode,
      variant_id: id(i + 1),
      product_id: id(i + 20000),
      current,
      stored: structuredClone(current),
      native_woo_product_id: null,
      native_woo_variation_id: null,
      barcode_binding_count: 1,
      variant_active: true,
      product_active: true,
      unit_code: "PIECE",
    };
  });
  return {
    source,
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      rows,
      inventory_balances: 0,
      inventory_movements: 0,
      evidence_window: {
        table_audits_equal: true,
        simultaneous_transaction: false,
      },
    },
    heldPlan: {
      source_sha256:
        "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93",
      source_rows_sha256: digest(source),
      held: source.slice(15961).map((s) => ({
        barcode: s.barcode,
        reasons: ["DISPLAY_OR_SALES_RESTRICTION"],
      })),
    },
    previous: {
      project_id: "zsezjtswqeijboezvado",
      rows: rows
        .slice(0, 15876)
        .map((r) => ({ barcode: r.barcode, variant_id: r.variant_id })),
    },
    tableAudit: [],
  };
}
describe("full source/native evidence composition without another reconciler", () => {
  it("accounts for15961+435 and preserves15876 UUIDs while observing85new ones", () => {
    const x = fixture(),
      r = auditCompleteCatalogEvidence(x);
    expect(r.summary).toMatchObject({
      source_codes: 16396,
      loaded_codes: 15961,
      held_codes: 435,
      exact_source_rows: 15961,
      review_rows: 0,
      uuid_preserved: 15876,
      additional_observed_uuid_rows: 85,
    });
    expect(r.write_allowed).toBe(false);
    expect(r.photos.commercial_eligibility_verified).toBe(false);
    expect(r.comparison_interpretation.fields.department).toEqual({
      equal: 15961,
      different: 0,
      unavailable: 0,
    });
    expect(r.comparison_interpretation.owner_questions_generated).toBe(0);
  });
  it("separates a literalpricecandidate from attribute provenance without approving either", () => {
    const x = fixture();
    x.snapshot.rows[0].current.price_cents = 1100;
    x.snapshot.rows[0].stored.price_cents = 1100;
    x.snapshot.rows[1].current.attributes = { TALLA: "S" };
    x.snapshot.rows[1].stored.attributes = { TALLA: "S" };
    const r = auditCompleteCatalogEvidence(x);
    expect(r.summary.review_rows).toBe(2);
    expect(r.summary.price_only_candidates_for_protected_preflight).toBe(1);
    expect(r.technical_queue.every((q) => q.auto_apply === false)).toBe(true);
    expect(r.price_preflight_candidates[0]).toMatchObject({
      current_cents: 1100,
      source_price_literal: "10",
      proposed_cents: 1000,
      complete_price_writer_state_captured: false,
      mutation_payload: false,
      auto_apply: false,
    });
    expect(r.comparison_interpretation.fields.price_cents.different).toBe(1);
    expect(r.comparison_interpretation.fields.attributes.different).toBe(1);
    expect(
      r.comparison_interpretation.differences_are_not_operational_blocks,
    ).toBe(true);
    expect(
      r.technical_queue.find(
        (q) => q.kind === "SOURCE_ATTRIBUTE_OR_WOO_PROVENANCE_REVIEW",
      ).codes,
    ).toEqual([x.source[1].barcode]);
  });
  it("retains a changed UUID even when every source field still matches", () => {
    const x = fixture();
    x.previous.rows[0].variant_id = id(999999);
    const r = auditCompleteCatalogEvidence(x);
    expect(r.summary.uuid_changed).toBe(1);
    expect(r.results[0].reasons).toContain("UUID_CHANGED_SINCE_PRIOR_CAPTURE");
  });
  it("keeps unavailable nativeprojection incoverage, never filling it fromsource", () => {
    const x = fixture();
    x.snapshot.rows[0].current = null;
    const r = auditCompleteCatalogEvidence(x);
    expect(r.summary.loaded_codes).toBe(15961);
    expect(r.summary.unavailable_current_projections).toBe(1);
    expect(r.results[0].reasons).toContain(
      "NATIVE_CURRENT_PROJECTION_MISSING_OR_MANAGED_CODE_DIFFERS",
    );
  });
  it("keeps exact raw highprecisionprice separate from zero and never rounds either", () => {
    const x = fixture();
    for (const [i, value] of [
      [15961, "3100.00024"],
      [15962, "0"],
    ]) {
      x.source[i].fields.precio1 = value;
      x.heldPlan.held[i - 15961].reasons.push("PUBLIC_PRICE_INVALID");
    }
    x.heldPlan.source_rows_sha256 = digest(x.source);
    const r = auditCompleteCatalogEvidence(x);
    expect(r.held.price_invalid_kinds).toEqual({
      RAW_PRICE_PRECISION_REVIEW_NO_ROUNDING: 1,
      ZERO_PRICE_REVIEW: 1,
    });
    expect(r.held.rows[0].retail_source).toBe("3100.00024");
    expect(r.inventory_operations).toBe(0);
  });
  it.each(["partition", "sourcefield", "UUIDduplicate"])(
    "rejects incomplete or contradictory%s before output",
    (kind) => {
      const x = fixture();
      if (kind === "partition") x.heldPlan.held.pop();
      if (kind === "sourcefield") x.source[0].fields["clave1 *"] = "1";
      if (kind === "UUIDduplicate")
        x.previous.rows[0].variant_id = x.previous.rows[1].variant_id;
      expect(() => auditCompleteCatalogEvidence(x)).toThrow();
    },
  );
});
