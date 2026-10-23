import { describe, it, expect } from "vitest";
import { prepareSicarPublicPrices } from "../../scripts/m9/catalogo-precio-publico-plan.mjs";
// Deliberately incomplete synthetic source: identity claims do not substitute
// for the exact private source preimage. Positive real-source QA stays private.
function input() {
  const o = {
    barcode: "11777",
    description: "SYNTHETIC NOT THE PINNED SOURCE",
    fields: {
      "clave1 *": "11777",
      "descripción *": "SYNTHETIC NOT THE PINNED SOURCE",
      precio1: "8100",
    },
    issues: [],
    display_only: null,
    classification: "MATCH_EXACT_VARIANT",
    product_id: 21768,
    variation_id: 21826,
    candidate_product_ids: [21768],
    candidate_variation_ids: [21826],
    attributes: [{ name: "Talla", value: "56" }],
    commercial_checks: [
      "PRECIO_WOO_DISTINTO_PUBLICO; revisar promocion o precio normal, no corregir automaticamente",
    ],
  };
  const n = structuredClone(o);
  n.fields.precio1 = "8300";
  n.commercial_checks = [];
  return {
    protocol: "m9-sicar-public-price-linked-1",
    before: [o],
    after: [n],
    context: { observed_at: "2026-10-23T14:45:01.577Z", expected_state: [{}] },
    asOf: "2026-10-23T14:46:00.000Z",
    request_id: "11111111-1111-4111-8111-111111111111",
    source_before_sha256:
      "33b1d36200f8db0eecf0cd1fbdd1c76400ee291d747348a6c87881f39043cc44",
    source_after_sha256:
      "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93",
  };
}
describe("11777 fixed-source boundary without publishing its private raw row", () => {
  it("holds forged source bytes despite correct literal identity claims", () =>
    expect(() => prepareSicarPublicPrices(input())).toThrow(
      /LITERAL_SOURCE_CHANGED/,
    ));
  const cases = [
    [
      "unknown protocol",
      (f) => (f.protocol = "other"),
      /UNSUPPORTED_PRICE_PROTOCOL/,
    ],
    [
      "wrong cut",
      (f) => (f.source_after_sha256 = "a".repeat(64)),
      /ORIGINAL_SICAR_CUTS/,
    ],
    ["invalid request", (f) => (f.request_id = "invalid"), /REQUEST_UUID/],
    [
      "expired context",
      (f) => (f.asOf = "2026-10-23T15:45:01.577Z"),
      /STALE_CONTEXT/,
    ],
    [
      "future context",
      (f) => (f.asOf = "2026-10-23T13:45:01.577Z"),
      /STALE_CONTEXT/,
    ],
    [
      "duplicate source",
      (f) => f.before.push(structuredClone(f.before[0])),
      /ONE_LITERAL_ROW/,
    ],
    [
      "another native row",
      (f) => f.context.expected_state.push({}),
      /ONE_LITERAL_ROW/,
    ],
    [
      "literal code mismatch",
      (f) => (f.after[0].fields["clave1 *"] = "11777 "),
      /SOURCE_IDENTITY/,
    ],
    [
      "size57",
      (f) => (f.after[0].attributes[0].value = "57"),
      /SOURCE_IDENTITY/,
    ],
    [
      "ambiguous Woo parent",
      (f) => f.after[0].candidate_product_ids.push(1),
      /SOURCE_IDENTITY/,
    ],
    [
      "unexpected commercial reservation",
      (f) => (f.after[0].commercial_checks = ["OTHER_HOLD"]),
      /COMMERCIAL_CONTEXT/,
    ],
  ];
  for (const [name, mutate, re] of cases)
    it("holds " + name, () => {
      const f = input();
      mutate(f);
      expect(() => prepareSicarPublicPrices(f)).toThrow(re);
    });
});
