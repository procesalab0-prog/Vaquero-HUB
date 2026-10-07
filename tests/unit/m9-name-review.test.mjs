import { it, expect } from "vitest";
import { prepareNameReviews } from "../../scripts/m9/prepare-name-review.mjs";
const fixture = () => {
  const row = {
    barcode: "0042",
    product_name: "Camisa",
    woo_product_id: 20,
    woo_variation_id: 21,
    description: "CDM",
    department: "CABALLERO",
    section: "CAMISAS",
    price_cents: 74000,
    cost_cents: null,
    attributes: { TALLA: "M" },
  };
  return {
    rows: [row],
    ledger: {
      version: "m9-complete-cut-1",
      ledger: [
        {
          barcode: "0042",
          state: "DESTINATION_NAME_REVIEW",
          preparation_holds: [],
        },
      ],
    },
    woo: {
      pagination_complete: true,
      products: [
        { id: 10, name: "Camisa", short_description: "AB", status: "publish" },
        { id: 20, name: "Camisa", short_description: "CD", status: "publish" },
      ],
    },
    source: [
      {
        barcode: "0042",
        description: "CDM",
        fields: {
          precio1: "740",
          departamento: "CABALLERO",
          categoria: "CAMISAS",
        },
        product_id: 20,
        variation_id: 21,
        attributes: [{ name: "Talla", value: "M" }],
        classification: "MATCH_EXACT_VARIANT",
        manual_review: false,
        issues: [],
        display_only: null,
      },
    ],
    contexts: [{ name: "Camisa", context_sha256: "a".repeat(64) }],
  };
};
const run = (f) =>
  prepareNameReviews(f.ledger, f.rows, f.woo, f.source, f.contexts);
it("binds exact rows, source identities and destination fingerprint without modifying input", () => {
  const f = fixture(),
    before = JSON.stringify(f),
    r = run(f);
  expect(JSON.stringify(f)).toBe(before);
  expect(r.cases[0].rows[0].barcode).toBe("0042");
  expect(r.summary.publication_allowed).toBe(false);
  expect(r.evidence_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(run(f)).toEqual(r);
});
it("rejects reused and overlapping bases rather than treating names as identities", () => {
  for (const base of ["AB", "ABC", ""]) {
    const f = fixture();
    f.woo.products[1].short_description = base;
    expect(() => run(f)).toThrow("IDENTITY_REVIEW_REQUIRED");
  }
});
it("rejects changed price, barcode, attributes and costs", () => {
  for (const change of [
    (f) => f.rows[0].price_cents++,
    (f) => (f.rows[0].barcode = "42"),
    (f) => (f.rows[0].attributes.TALLA = "L"),
    (f) => (f.rows[0].cost_cents = 0),
  ]) {
    const f = fixture();
    change(f);
    expect(() => run(f)).toThrow();
  }
});
it("keeps editorial, taxonomy, owner and publication guards", () => {
  for (const change of [
    (f) => (f.ledger.ledger[0].preparation_holds = ["OWNER"]),
    (f) => (f.source[0].issues = ["x"]),
    (f) => (f.source[0].manual_review = true),
    (f) => (f.woo.products[1].status = "private"),
    (f) => (f.source[0].display_only = "MUESTRA"),
  ]) {
    const f = fixture();
    change(f);
    expect(() => run(f)).toThrow();
  }
});
it("requires unique literal source codes and destination context", () => {
  for (const change of [
    (f) => f.source.push(structuredClone(f.source[0])),
    (f) => f.rows.push(structuredClone(f.rows[0])),
    (f) => (f.contexts = []),
    (f) => (f.contexts[0].context_sha256 = "x"),
  ]) {
    const f = fixture();
    change(f);
    expect(() => run(f)).toThrow();
  }
});
it("destination and payload changes invalidate packet fingerprint", () => {
  const f = fixture(),
    a = run(f);
  f.contexts[0].context_sha256 = "b".repeat(64);
  expect(run(f).evidence_sha256).not.toBe(a.evidence_sha256);
});
