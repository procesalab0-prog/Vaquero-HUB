import { it, expect } from "vitest";
import { prepareSicarOnly } from "../../scripts/m9/prepare-sicar-only.mjs";
import {
  evidenceFor,
  prepareSicarBatches,
} from "../../scripts/m9/plan-sicar-only.mjs";
function fixture(counts) {
  let n = 0;
  const records = counts.flatMap((count, g) =>
    Array.from({ length: count }, (_, i) => {
      const barcode = String(++n).padStart(5, "0"),
        description = `MODEL${g}T.${i}`;
      return {
        barcode,
        description,
        classification: "SICAR_ONLY",
        fields: {
          "clave1 *": barcode,
          "descripción *": description,
          departamento: "DAMA",
          categoria: "TEST",
          precio1: "10",
          "(s/n) mostrar en ventas": "s",
        },
      };
    }),
  );
  const review = prepareSicarOnly(records);
  review.sources = { sicar_sha256: "a".repeat(64) };
  const decisions = counts.map((_, g) => {
    const rows = review.records.filter((r) =>
      r.description.startsWith(`MODEL${g}T.`),
    );
    return {
      family_key: `model-${g}`,
      product_name: `MODEL ${g}`,
      status: "approved",
      reviewer: "TEST",
      reason: "Synthetic fixture",
      reviewed_at: "2026-10-06",
      evidence_sha256: evidenceFor(rows),
      members: rows.map((r) => ({
        barcode: r.barcode,
        attributes: { TALLA: r.proposed.suffix },
      })),
    };
  });
  return { review, decisions };
}
it("splits more than 1000 rows without splitting families or losing codes", () => {
  const { review, decisions } = fixture([400, 400, 250]);
  const r = prepareSicarBatches(review, decisions);
  expect(r.batches.map((b) => b.packet.rows.length)).toEqual([400, 400, 250]);
  expect(
    new Set(r.batches.flatMap((b) => b.packet.rows.map((r) => r.barcode))).size,
  ).toBe(1050);
});
it("fails rather than fragmenting a family larger than the limit", () => {
  const { review, decisions } = fixture([4]);
  expect(() => prepareSicarBatches(review, decisions, 3)).toThrow(
    "FAMILY_EXCEEDS_BATCH_LIMIT",
  );
});
it("detects overlaps before splitting across batches", () => {
  const { review, decisions } = fixture([2, 2]);
  decisions[1].members[0] = decisions[0].members[0];
  expect(() => prepareSicarBatches(review, decisions, 2)).toThrow(
    "BLOCKED_DECISIONS",
  );
});
it("preserves deterministic order and packet hashes", () => {
  const { review, decisions } = fixture([2, 2, 2]);
  const a = prepareSicarBatches(review, decisions, 3);
  expect(prepareSicarBatches(review, decisions.reverse(), 3)).toEqual(a);
});
it("does not include pending records in approved batches", () => {
  const { review, decisions } = fixture([2, 3]);
  const r = prepareSicarBatches(review, decisions.slice(0, 1));
  expect(r.rows).toBe(2);
  expect(r.pending_rows).toBe(3);
});
it("does not create empty database calls", () => {
  const { review } = fixture([2]);
  expect(prepareSicarBatches(review, []).batches).toEqual([]);
});
