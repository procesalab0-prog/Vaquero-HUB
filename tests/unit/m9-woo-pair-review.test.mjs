import { describe, it, expect } from "vitest";
import { reviewWooPairChanges } from "../../scripts/m9/review-woo-pair-changes.mjs";
function fixture() {
  const s = {
    barcode: "0001",
    row: 2,
    description: "BASES",
    fields: { "clave1 *": "0001", "descripción *": "BASES" },
    issues: [],
    attributes: [{ name: "Talla", value: "S" }],
    commercial_checks: [],
    manual_review: false,
    classification: "MATCH_EXACT_VARIANT",
    product_id: 10,
    variation_id: 11,
    matching_rule: "EXACT_ATTRIBUTE",
    candidate_product_ids: [10],
    candidate_variation_ids: [11],
  };
  const old = {
    ...structuredClone(s),
    product_id: null,
    variation_id: null,
    classification: "SICAR_ONLY",
    manual_review: true,
    attributes: [],
    matching_rule: null,
  };
  const p = {
    id: 10,
    name: "SYNTHETIC",
    short_description: "BASE",
    base: "BASE",
    type: "variable",
    status: "publish",
    issues: [],
    variants: [
      {
        id: 11,
        status: "publish",
        attributes: [{ name: "Talla", value: "S" }],
        issues: [],
      },
    ],
  };
  const r = {
    barcode: "0001",
    variant_id: "variant1",
    product_id: "native1",
    current: { barcode: "0001" },
    stored: { barcode: "0001" },
    native_woo_product_id: null,
    native_woo_variation_id: null,
    source_sha256: "a".repeat(64),
  };
  return {
    before: [old],
    after: [s],
    wooBefore: [structuredClone(p)],
    wooAfter: [p],
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      evidence_window: {
        table_audits_equal: true,
        simultaneous_transaction: false,
      },
      rows: [r],
    },
    expectedCodes: ["0001"],
  };
}
describe("protected read-only review of existing canonical pair deltas", () => {
  it("keeps literal code and UUID while proposing only an unoccupied exact published candidate", () => {
    const r = reviewWooPairChanges(fixture());
    expect(r.rows[0]).toMatchObject({
      barcode: "0001",
      uuid: { variant_id: "variant1", product_id: "native1" },
      judgment: "POSIBLE_PROPUESTA",
      write_allowed: false,
      assignment_allowed: false,
      grouping_allowed: false,
      inventory_import_allowed: false,
    });
    expect(r.operational_payload_generated).toBe(false);
  });
  it("keeps a pair already natively bound without approving a stock conflict", () => {
    const x = fixture();
    Object.assign(x.snapshot.rows[0], {
      native_woo_product_id: 10,
      native_woo_variation_id: 11,
    });
    x.after[0].classification = "CONFLICT";
    x.after[0].commercial_checks = ["EXISTENCIA_DIFIERE; different cuts"];
    expect(reviewWooPairChanges(x).rows[0]).toMatchObject({
      judgment: "MANTENER",
      commercial_eligibility_assessed: false,
      source_stock_used_to_select_identity: false,
    });
  });
  it("retains an occupied target despite a new unique analyzer match", () => {
    const x = fixture();
    x.snapshot.rows.push({
      ...structuredClone(x.snapshot.rows[0]),
      barcode: "2",
      variant_id: "variant2",
      product_id: "native2",
      current: { barcode: "2" },
      stored: { barcode: "2" },
      native_woo_product_id: 10,
      native_woo_variation_id: 11,
    });
    const r = reviewWooPairChanges(x).rows[0];
    expect(r.judgment).toBe("REVISION");
    expect(r.identity_reasons).toContain(
      "TARGET_OCCUPIED_BY_OTHER_LITERAL_CODE",
    );
    expect(r.target_occupants[0].barcode).toBe("2");
  });
  it("retains the whole parent when another native family occupies a different variation", () => {
    const x = fixture();
    x.snapshot.rows.push({
      ...structuredClone(x.snapshot.rows[0]),
      barcode: "2",
      variant_id: "variant2",
      product_id: "native2",
      current: { barcode: "2" },
      stored: { barcode: "2" },
      native_woo_product_id: 10,
      native_woo_variation_id: 12,
    });
    const r = reviewWooPairChanges(x).rows[0];
    expect(r.judgment).toBe("REVISION");
    expect(r.identity_reasons).toContain(
      "PARENT_ALREADY_BOUND_TO_OTHER_NATIVE_FAMILY",
    );
  });
  it("does not remove an old link or equate Cafe with CAFÉ", () => {
    const x = fixture();
    x.before[0] = { ...structuredClone(x.after[0]) };
    x.after[0] = {
      ...x.after[0],
      product_id: null,
      variation_id: null,
      classification: "SPECIAL_SUFFIX",
      manual_review: true,
      attributes: [],
    };
    Object.assign(x.snapshot.rows[0], {
      native_woo_product_id: 10,
      native_woo_variation_id: 11,
    });
    x.wooBefore[0].variants[0].attributes = [{ name: "Color", value: "Cafe" }];
    x.wooAfter[0].variants[0].attributes = [{ name: "Color", value: "CAFÉ" }];
    const r = reviewWooPairChanges(x).rows[0];
    expect(r).toMatchObject({
      judgment: "REVISION",
      cause: "EXACT_ATTRIBUTE_TEXT_CHANGED_KEEP_HISTORY",
      prior_link_must_remain_untouched: true,
    });
    expect(r.observed_native_pair).toEqual({
      product_id: 10,
      variation_id: 11,
    });
  });
  it.each(["unpublished", "attributes", "rule", "claims"])(
    "retains incomplete%s evidence",
    (kind) => {
      const x = fixture();
      if (kind === "unpublished") x.wooAfter[0].status = "draft";
      if (kind === "attributes")
        x.wooAfter[0].variants[0].attributes = [{ name: "Talla", value: "M" }];
      if (kind === "rule") x.after[0].matching_rule = null;
      if (kind === "claims") x.after[0].candidate_product_ids = [10, 20];
      expect(reviewWooPairChanges(x).rows[0].judgment).toBe("REVISION");
    },
  );
  it("retains a native projection that differs from its applied source", () => {
    const x = fixture();
    x.snapshot.rows[0].current.attributes = { TALLA: "M" };
    expect(reviewWooPairChanges(x).rows[0]).toMatchObject({
      judgment: "REVISION",
      identity_reasons: ["NATIVE_PROJECTION_DIFFERS_FROM_MANAGED"],
    });
  });
  it.each(["literal", "source", "scope", "duplicate", "nativeid"])(
    "rejects%s drift before generating a report",
    (kind) => {
      const x = fixture();
      if (kind === "literal") x.after[0].fields["clave1 *"] = "1";
      if (kind === "source") x.after[0].fields.extra = "changed";
      if (kind === "scope") x.expectedCodes = [];
      if (kind === "duplicate") x.after.push(structuredClone(x.after[0]));
      if (kind === "nativeid") delete x.snapshot.rows[0].native_woo_product_id;
      expect(() => reviewWooPairChanges(x)).toThrow();
    },
  );
});
