import { describe, it, expect } from "vitest";
import { prepareSicarOnly } from "../../scripts/m9/prepare-sicar-only.mjs";
import {
  planSicarOnly,
  evidenceFor,
} from "../../scripts/m9/plan-sicar-only.mjs";
const fixture = () => {
  const review = prepareSicarOnly(
    ["S", "M"].map((s, i) => ({
      barcode: `00${i}`,
      description: `ABCT.${s}`,
      classification: "SICAR_ONLY",
      fields: {
        "clave1 *": `00${i}`,
        "descripción *": `ABCT.${s}`,
        departamento: "DAMA",
        categoria: "CAMISAS",
        precio1: "99",
        "(s/n) mostrar en ventas": "s",
      },
    })),
  );
  const decision = {
    family_key: "reviewed-abc",
    product_name: "ABC",
    status: "approved",
    reviewer: "Reviewer fixture",
    reason: "Synthetic test only",
    reviewed_at: "2026-10-06",
    evidence_sha256: evidenceFor(review.records),
    members: review.records.map((r, i) => ({
      barcode: r.barcode,
      attributes: { TALLA: i ? "M" : "S" },
    })),
  };
  return { review, decision };
};
describe("SICAR independent catalog planning", () => {
  it("keeps every unreviewed code pending without creating parents", () => {
    const { review } = fixture();
    const p = planSicarOnly(review, []);
    expect(p.pending_codes).toEqual(["000", "001"]);
    expect(p.families).toEqual([]);
  });
  it("preserves codes and requires independent destination validation", () => {
    const { review, decision } = fixture();
    const p = planSicarOnly(review, [decision]);
    expect(p.summary.reviewed_rows).toBe(2);
    expect(p.write_allowed).toBe(false);
    expect(p.families[0].rows[0]).toMatchObject({
      barcode: "000",
      cost_cents: null,
      woo_product_id: null,
      woo_variation_id: null,
    });
    expect(JSON.stringify(p)).not.toContain("existencia");
  });
  it("reopens review when source evidence changes", () => {
    const { review, decision } = fixture();
    review.records[0].evidence_sha256 = "changed";
    expect(planSicarOnly(review, [decision]).errors[0].reasons).toContain(
      "STALE_EVIDENCE",
    );
  });
  it("blocks overlapping decisions in both families", () => {
    const { review, decision } = fixture();
    const p = planSicarOnly(review, [
      decision,
      { ...decision, family_key: "other" },
    ]);
    expect(p.families).toHaveLength(0);
    expect(p.errors).toHaveLength(2);
  });
  it("rejects repeated attribute combinations", () => {
    const { review, decision } = fixture();
    decision.members[1].attributes = { TALLA: "S" };
    expect(planSicarOnly(review, [decision]).errors[0].reasons).toContain(
      "DUPLICATE_ATTRIBUTES",
    );
  });
  it("does not override unresolved source problems", () => {
    const { review, decision } = fixture();
    review.records[0].issues.push("TAXONOMY_REVIEW");
    expect(planSicarOnly(review, [decision]).summary.reviewed_rows).toBe(0);
  });
  it("requires real review metadata and a valid calendar date", () => {
    const { review, decision } = fixture();
    decision.reviewed_at = "2026-02-30";
    expect(planSicarOnly(review, [decision]).errors[0].reasons).toContain(
      "REVIEW_REQUIRED",
    );
  });
  it("is reproducible regardless of member ordering", () => {
    const { review, decision } = fixture();
    const p = planSicarOnly(review, [decision]);
    decision.members.reverse();
    review.records.reverse();
    expect(planSicarOnly(review, [decision])).toEqual(p);
  });
  it("retains classification per variant across departments", () => {
    const { review, decision } = fixture();
    review.records[1].department = "CABALLERO";
    decision.evidence_sha256 = evidenceFor(review.records);
    const p = planSicarOnly(review, [decision]);
    expect(p.families[0].rows.map((r) => r.department)).toEqual([
      "DAMA",
      "CABALLERO",
    ]);
  });
});
