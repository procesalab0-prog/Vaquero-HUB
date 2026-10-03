import { describe, it, expect } from "vitest";
import { prepareFamily } from "../../scripts/m9/prepare-staging-family.mjs";

function fixture() {
  const row = {
    barcode: "0001",
    description: "MODEL T.XXL",
    product_id: 10,
    variation_id: 11,
    manual_review: false,
    classification: "MATCH_EXACT_VARIANT",
    issues: [],
    commercial_checks: [],
    display_only: null,
    cost_status: "not_captured",
    price_mapping_status: "retail_confirmed_other_levels_undefined",
    attributes: [{ name: "Talla", value: "XXL" }],
    fields: {
      "clave1 *": "0001",
      "descripción *": "MODEL T.XXL",
      departamento: "DAMA",
      categoria: "CAMISAS",
      precio1: "820.05",
      existencia: "99",
    },
  };
  const member = {
    woo_id: 11,
    status: "publish",
    state: "EXACT_CANONICAL_LINK",
    attributes: [{ name: "Talla", option: "XXL" }],
    sicar: [
      {
        barcode: "0001",
        description: row.description,
        department: "DAMA",
        section: "CAMISAS",
        retail_sicar: "820.05",
      },
    ],
  };
  const report = {
    version: "m9-web-family-review-1",
    families: [
      {
        woo_product_id: 10,
        name: "Camisa",
        type: "variable",
        issues: [],
        diagnostic_state: "IDENTITY_AND_CATEGORIES_CHECKED_NOT_APPROVED",
        historical_child_ids: [],
        sicar_candidate_rows: [],
        woo_members: [member],
      },
    ],
  };
  return { row, member, report };
}
describe("staging family preparation", () => {
  it("preserves leading zeros, literal XXL and public price, excludes stock and unknown cost", () => {
    const { row, report } = fixture();
    const [result] = prepareFamily(report, [row], 10);
    expect(result).toMatchObject({
      barcode: "0001",
      attributes: { TALLA: "XXL" },
      price_cents: 82005,
      cost_cents: null,
    });
    expect(Object.keys(result)).toHaveLength(10);
    expect(result).not.toHaveProperty("existencia");
  });
  it("rejects ambiguous barcodes and manually reviewed rows", () => {
    const { row, report } = fixture();
    expect(() => prepareFamily(report, [row, row], 10)).toThrow(
      "AMBIGUOUS_BARCODE",
    );
    row.manual_review = true;
    expect(() => prepareFamily(report, [row], 10)).toThrow(
      "SOURCE_DISAGREEMENT",
    );
  });
  it("does not equate XXL and 2XL", () => {
    const { row, member, report } = fixture();
    member.attributes[0].option = "2XL";
    expect(() => prepareFamily(report, [row], 10)).toThrow(
      "ATTRIBUTE_DISAGREEMENT",
    );
  });
  it("rejects repeated children and incomplete or changed source evidence", () => {
    const { row, member, report } = fixture();
    report.families[0].woo_members.push(member);
    expect(() => prepareFamily(report, [row], 10)).toThrow("DUPLICATE_MEMBER");
    report.families[0].woo_members.pop();
    row.fields.precio1 = "1";
    expect(() => prepareFamily(report, [row], 10)).toThrow(
      "SOURCE_DISAGREEMENT",
    );
    report.families[0].historical_child_ids = [12];
    expect(() => prepareFamily(report, [row], 10)).toThrow("UNRESOLVED_FAMILY");
  });
});
