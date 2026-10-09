import { it, expect } from "vitest";
import { inspectRollback } from "../../scripts/m9/inspect-rollback.mjs";
function fixture() {
  const row = {
    id: 18,
    type: "simple",
    status: "draft",
    sku: "SKU",
    attributes: [],
    name: "Bolsa",
    regular_price: "100.00",
    stock_quantity: 7,
    meta_data: [
      { key: "_mi_tienda_barcode", value: "0007" },
      { key: "_mi_tienda_variant_id", value: "variant-a" },
    ],
  };
  return {
    version: "m9-rollback-review-input-1",
    store: {
      id: "m9-local-2026-10-02",
      base_url: "http://127.0.0.1:9417",
      environment: "LOCAL_WOO_TEST",
    },
    kind: "parent",
    fields: ["regular_price"],
    before: structuredClone(row),
    applied: { ...structuredClone(row), regular_price: "101.00" },
    current: {
      ...structuredClone(row),
      regular_price: "101.00",
      name: "Edicion posterior",
      stock_quantity: 5,
    },
  };
}
it("reviews only own price and leaves later name/stock outside scope", () => {
  const x = fixture(),
    before = structuredClone(x),
    r = inspectRollback(x);
  expect(r.reviewable_fields).toEqual(["regular_price"]);
  expect(r.automatic_rollback_allowed).toBe(false);
  expect(r.production_allowed).toBe(false);
  expect(r.atomic_concurrency_control).toBe(false);
  expect(x).toEqual(before);
});
it("blocks the entire resource if another selected field conflicts", () => {
  const x = fixture();
  x.fields.push("name");
  x.applied.name = "Nuestro nombre";
  expect(inspectRollback(x)).toMatchObject({
    state: "MANUAL_REVIEW",
    reviewable_fields: [],
  });
});
it("does not undo fields that this operation never changed", () => {
  const x = fixture();
  x.fields = ["name"];
  expect(inspectRollback(x).fields[0].state).toBe(
    "NOT_CHANGED_BY_THIS_OPERATION",
  );
});
it("recognizes an already restored price", () => {
  const x = fixture();
  x.current.regular_price = "100.00";
  expect(inspectRollback(x).fields[0].state).toBe("ALREADY_RESTORED");
});
it.each(["7", 7])("preserves literal barcode identity: %s", (v) => {
  const x = fixture();
  x.current.meta_data[0].value = v;
  if (typeof v === "string")
    expect(inspectRollback(x).state).toBe("MANUAL_REVIEW");
  else
    expect(() => inspectRollback(x)).toThrow(
      "UNIQUE_LITERAL_IDENTITY_REQUIRED",
    );
});
it("rejects duplicate identity metadata", () => {
  const x = fixture();
  x.current.meta_data.push(x.current.meta_data[0]);
  expect(() => inspectRollback(x)).toThrow("UNIQUE_LITERAL_IDENTITY_REQUIRED");
});
it("blocks changed SKU, resource ID or attributes", () => {
  for (const [k, v] of [
    ["sku", "OTHER"],
    ["id", 19],
    ["attributes", [{ name: "Talla", option: "28" }]],
  ]) {
    const x = fixture();
    x.current[k] = v;
    expect(inspectRollback(x).state).toBe("MANUAL_REVIEW");
  }
});
it.each(["stock_quantity", "sale_price", "status", "categories", "meta_data"])(
  "rejects unsupported rollback field %s",
  (f) => {
    const x = fixture();
    x.fields = [f];
    expect(() => inspectRollback(x)).toThrow("UNSUPPORTED_ROLLBACK_FIELD");
  },
);
it("rejects missing data instead of treating it as empty", () => {
  const x = fixture();
  delete x.current.regular_price;
  expect(() => inspectRollback(x)).toThrow("MISSING_LITERAL_FIELD");
});
it("rejects production host and non-draft parent", () => {
  const x = fixture();
  x.store.base_url = "https://vaquerosm.com";
  expect(() => inspectRollback(x)).toThrow();
  const y = fixture();
  y.current.status = "publish";
  expect(() => inspectRollback(y)).toThrow("DRAFT_PARENT_REQUIRED");
});
it("requires variant membership in all three parent snapshots", () => {
  const x = fixture();
  x.kind = "variant";
  x.parent_id = 23;
  x.parent_snapshots = Array.from({ length: 3 }, () => ({
    id: 23,
    type: "variable",
    status: "draft",
    variations: [18],
  }));
  expect(inspectRollback(x).reviewable_fields).toEqual(["regular_price"]);
  x.parent_snapshots[2].variations = [];
  expect(() => inspectRollback(x)).toThrow("VARIANT_PARENT_CHANGED");
});
