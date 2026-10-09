import { it, expect } from "vitest";
import { reviewDistinctNamedParents } from "../../scripts/m9/review-distinct-named-parents.mjs";
const products = () => ({
  products: [
    { id: 1, name: "Camisa", status: "publish", short_description: "CAB-A" },
    { id: 2, name: "CAMISA", status: "private", short_description: "CAB-B" },
  ],
});
it("proves different literal bases while retaining every parent ID and status", () => {
  const w = products(),
    before = JSON.stringify(w),
    r = reviewDistinctNamedParents(w);
  expect(
    r.every(
      (x) => x.state === "DISTINCT_LITERAL_BASES" && x.write_allowed === false,
    ),
  ).toBe(true);
  expect(r[0].peers.map((p) => p.woo_product_id)).toEqual([1, 2]);
  expect(r[0].peers[1].status).toBe("private");
  expect(JSON.stringify(w)).toBe(before);
  expect(reviewDistinctNamedParents(w)).toEqual(r);
});
it("holds same base across repeated names or a third differently named parent", () => {
  const a = products();
  a.products[1].short_description = "cab-a";
  expect(reviewDistinctNamedParents(a)[0].reasons).toContain(
    "SAME_BASE_REQUIRES_MANUAL_REVIEW",
  );
  const b = products();
  b.products.push({ id: 3, name: "Other", short_description: "CAB-A" });
  expect(reviewDistinctNamedParents(b)[0].reasons).toContain(
    "BASE_REUSED_IN_WOO",
  );
});
it("does not join HTML, accept a phrase as a base, or split numeric tails", () => {
  for (const text of ["<p>A</p><p>B</p>", "A B", ""]) {
    const w = products();
    w.products[1].short_description = text;
    expect(reviewDistinctNamedParents(w)[0].state).toBe("MANUAL_REVIEW");
  }
  const w = products();
  w.products[1].short_description = "CAB-A40";
  expect(reviewDistinctNamedParents(w)[0].reasons).toContain(
    "OVERLAPPING_BASES_REVIEW",
  );
});
it("normalizes only for comparison and retains literal codes including accents and zeroes", () => {
  const w = products();
  w.products[0].short_description = "00NIÑO";
  w.products[1].short_description = "00NINA";
  expect(reviewDistinctNamedParents(w)[0].peers[0].base_original).toBe(
    "00NIÑO",
  );
  expect(reviewDistinctNamedParents(w)[0].state).toBe("DISTINCT_LITERAL_BASES");
});
it("rejects duplicated IDs and never grants permission for a unique name", () => {
  const w = products();
  w.products[1].id = 1;
  expect(() => reviewDistinctNamedParents(w)).toThrow(
    "INVALID_OR_DUPLICATE_WOO_PARENT",
  );
  const r = reviewDistinctNamedParents({ products: [products().products[0]] });
  expect(r[0].state).toBe("UNIQUE_NAME");
  expect(r[0].write_allowed).toBe(false);
});
