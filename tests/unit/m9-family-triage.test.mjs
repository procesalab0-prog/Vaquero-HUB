import { expect, it } from "vitest";
import { triageFamilies } from "../../scripts/m9/triage-web-families.mjs";
function input(checks, issues = []) {
  return {
    version: "m9-web-family-review-1",
    woo_writes_enabled: false,
    families: [
      {
        woo_product_id: 1,
        name: "Producto",
        sicar_candidate_rows: [],
        woo_members: [
          {
            woo_id: 2,
            status: "publish",
            state: "CANONICAL_REVIEW",
            sicar: [
              {
                barcode: "001",
                product_id: 1,
                variation_id: 2,
                classification: "CONFLICT",
                issues,
                commercial_checks: checks,
              },
            ],
          },
        ],
      },
    ],
  };
}
it("separates stock observations without approving or modifying canonical evidence", () => {
  const r = input(["EXISTENCIA_DIFIERE; capturas y alcance pueden diferir"]),
    before = JSON.stringify(r);
  const out = triageFamilies(r);
  expect(out.members[0].bucket).toBe("STOCK_OBSERVATION_ONLY_NO_APPROVAL");
  expect(out.members[0].send_allowed).toBe(false);
  expect(out.members[0].sicar[0].barcode).toBe("001");
  expect(JSON.stringify(r)).toBe(before);
  expect(triageFamilies(r)).toEqual(out);
});
it("does not hide price holds or other issues in the stock bucket", () => {
  expect(
    triageFamilies(
      input([
        "EXISTENCIA_WOO_NO_DISPONIBLE",
        "PRECIO_WOO_DISTINTO_PUBLICO; revisar",
      ]),
    ).members[0].bucket,
  ).toBe("PRICE_REVIEW");
  expect(
    triageFamilies(input(["EXISTENCIA_WOO_NO_DISPONIBLE"], ["COLLISION"]))
      .members[0].bucket,
  ).toBe("OTHER_MANUAL_REVIEW");
  expect(triageFamilies(input(["NEW_UNKNOWN_WARNING"])).members[0].bucket).toBe(
    "OTHER_MANUAL_REVIEW",
  );
});
it("does not classify multiple assigned codes or unpublished variants as stock only", () => {
  const r = input(["EXISTENCIA_WOO_NO_DISPONIBLE"]);
  r.families[0].woo_members[0].sicar.push({
    ...r.families[0].woo_members[0].sicar[0],
    barcode: "002",
  });
  expect(triageFamilies(r).members[0].bucket).toBe("OTHER_MANUAL_REVIEW");
  const privateRow = input(["EXISTENCIA_WOO_NO_DISPONIBLE"]);
  privateRow.families[0].woo_members[0].status = "private";
  expect(triageFamilies(privateRow).members[0].bucket).toBe(
    "OTHER_MANUAL_REVIEW",
  );
});
it("keeps display-only and unmatched suffixes separate, without inventing an equivalence", () => {
  const r = input([]);
  r.families[0].sicar_candidate_rows = [
    {
      barcode: "03",
      classification: "SPECIAL_SUFFIX",
      reasons: [
        "MUESTRA_SOLO_EXHIBICION; no crear variante vendible automaticamente",
      ],
    },
    {
      barcode: "04",
      classification: "SPECIAL_SUFFIX",
      reasons: [
        "SUFIJO_SIN_VARIACION_EXACTA; atributos faltantes o no interpretables",
      ],
    },
  ];
  const out = triageFamilies(r);
  expect(out.candidates.map((c) => c.bucket)).toEqual([
    "DISPLAY_ONLY_EXISTING_RULE",
    "ATTRIBUTE_REVIEW",
  ]);
  expect(out.candidates.every((c) => c.send_allowed === false)).toBe(true);
});
