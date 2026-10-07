import { describe, it, expect } from "vitest";
import { prepareSicarOnly } from "../../scripts/m9/prepare-sicar-only.mjs";
import { planSicarOnly } from "../../scripts/m9/plan-sicar-only.mjs";
import {
  reviewSicarFamilies,
  familyReviewHtml,
} from "../../scripts/m9/review-sicar-families.mjs";

const fixture = (items) =>
  prepareSicarOnly(
    items.map(
      ([barcode, description, department = "DAMA", section = "CAMISAS"]) => ({
        barcode,
        description,
        classification: "SICAR_ONLY",
        fields: {
          "clave1 *": barcode,
          "descripción *": description,
          departamento: department,
          categoria: section,
          precio1: "740",
          "(s/n) mostrar en ventas": "s",
        },
      }),
    ),
  );

describe("SICAR family review evidence", () => {
  it("covers every code once, preserves numeric tails and never approves a template", () => {
    const review = fixture([
      ["001", "MODELOT.S"],
      ["002", "MODELOT.M"],
      ["003", "BESTA512S27"],
    ]);
    const result = reviewSicarFamilies(review);
    expect(result.summary).toMatchObject({
      rows: 3,
      cases: 2,
      explicit_proposals: 1,
      unsplit_records: 1,
      approved_rows: 0,
    });
    expect(
      result.cases.flatMap((c) => c.members.map((r) => r.barcode)).sort(),
    ).toEqual(["001", "002", "003"]);
    expect(
      result.cases.find((c) => c.kind === "UNSPLIT_RECORD")
        .product_name_proposed,
    ).toBe("BESTA512S27");
    const plan = planSicarOnly(review, result.templates);
    expect(plan.summary.reviewed_rows).toBe(0);
    expect(
      plan.errors.every((e) => e.reasons.includes("REVIEW_REQUIRED")),
    ).toBe(true);
    expect(JSON.stringify(result.templates)).not.toContain('"approved"');
  });
  it("keeps classifications separate and exposes related cases without joining them", () => {
    const review = fixture([
      ["01", "MODELOT.S"],
      ["02", "MODELOT.M", "CABALLERO"],
      ["03", "MODELOT.L", "DAMA", "BLUSAS"],
    ]);
    const result = reviewSicarFamilies(review);
    expect(result.cases).toHaveLength(3);
    for (const c of result.cases) {
      expect(c.members).toHaveLength(1);
      expect(c.related_classification_cases).toHaveLength(2);
      expect(c.issues).toContain("BASE_IN_MULTIPLE_CLASSIFICATIONS");
    }
  });
  it("retains duplicate sizes as an unresolved issue and does not invent size/length dimensions", () => {
    const result = reviewSicarFamilies(
      fixture([
        ["01", "MODELOT.S"],
        ["02", "MODELOT.S"],
        ["03", "OTROT.30X32"],
      ]),
    );
    expect(
      result.cases.find((c) => c.product_name_proposed === "MODELO").issues,
    ).toContain("REPEATED_SUFFIX");
    expect(
      result.cases.find((c) => c.product_name_proposed === "OTRO").issues,
    ).toContain("SIZE_LENGTH_DIMENSIONS_REVIEW");
    expect(
      result.templates.find((t) => t.product_name === "OTRO").members[0]
        .attributes,
    ).toEqual({});
  });
  it("is deterministic and does not mutate verified source rows", () => {
    const review = fixture([
      ["001", "MODELOT.S"],
      ["002", "MODELOT.M"],
      ["003", "OTRO20"],
    ]);
    const before = structuredClone(review),
      first = reviewSicarFamilies(review);
    expect(review).toEqual(before);
    review.records.reverse();
    expect(reviewSicarFamilies(review)).toEqual(first);
  });
  it("rejects changed evidence, changed suffix proposals and repeated source codes", () => {
    const review = fixture([["001", "MODELOT.S"]]);
    const changed = structuredClone(review);
    changed.records[0].department = "CABALLERO";
    expect(() => reviewSicarFamilies(changed)).toThrow("ROW_EVIDENCE_CHANGED");
    const proposal = structuredClone(review);
    proposal.records[0].proposed.suffix = "L";
    expect(() => reviewSicarFamilies(proposal)).toThrow("PROPOSAL_CHANGED");
    review.records.push(review.records[0]);
    expect(() => reviewSicarFamilies(review)).toThrow(
      "DUPLICATE_OR_INVALID_CODE",
    );
  });
  it("escapes catalog markup in embedded data rather than executing it", () => {
    const result = reviewSicarFamilies(
      fixture([["001", '</script><script>alert("source")</script>']]),
    );
    const html = familyReviewHtml(result);
    expect(html).not.toContain('</script><script>alert("source")');
    expect(html).toContain("\\u003c/script>");
  });
});
