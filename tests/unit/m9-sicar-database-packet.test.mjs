import { it, expect } from "vitest";
import { prepareSicarOnly } from "../../scripts/m9/prepare-sicar-only.mjs";
import {
  evidenceFor,
  prepareSicarDatabasePacket,
} from "../../scripts/m9/plan-sicar-only.mjs";
const fixture = () => {
  const review = prepareSicarOnly([
    {
      barcode: "0001",
      description: "TEST",
      classification: "SICAR_ONLY",
      fields: {
        "clave1 *": "0001",
        "descripción *": "TEST",
        departamento: "DAMA",
        categoria: "CAMISAS",
        precio1: "123.45",
        "(s/n) mostrar en ventas": "s",
      },
    },
  ]);
  review.sources = { sicar_sha256: "a".repeat(64) };
  const decisions = [
    {
      family_key: "test",
      product_name: "TEST",
      status: "approved",
      reviewer: "Synthetic reviewer",
      reason: "Fixture only",
      reviewed_at: "2026-10-06",
      evidence_sha256: evidenceFor(review.records),
      members: [{ barcode: "0001", attributes: {} }],
    },
  ];
  return { review, decisions };
};
it("adapts exactly to the independent SQL contract without inventory or invented Woo ID", () => {
  const { review, decisions } = fixture();
  const p = prepareSicarDatabasePacket(review, decisions);
  expect(Object.keys(p.rows[0]).sort()).toEqual([
    "attributes",
    "barcode",
    "cost_cents",
    "department",
    "description",
    "family_key",
    "price_cents",
    "product_name",
    "section",
    "woo_variation_id",
  ]);
  expect(p.rows[0].barcode).toBe("0001");
  expect(p.approvals[0].payload).toEqual(p.rows[0]);
  expect(p.write_allowed).toBe(false);
});
it("does not emit partial executable packets when one decision is blocked", () => {
  const { review, decisions } = fixture();
  decisions[0].status = "pending";
  expect(() => prepareSicarDatabasePacket(review, decisions)).toThrow(
    "BLOCKED_DECISIONS",
  );
});
it("requires source provenance", () => {
  const { review, decisions } = fixture();
  delete review.sources;
  expect(() => prepareSicarDatabasePacket(review, decisions)).toThrow(
    "SOURCE_HASH_REQUIRED",
  );
});
it("empty approvals never infer families", () => {
  const { review } = fixture();
  expect(prepareSicarDatabasePacket(review, []).rows).toEqual([]);
});
