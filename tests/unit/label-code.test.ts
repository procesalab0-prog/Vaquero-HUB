import { describe, expect, it } from "vitest";

import { printableLabelCode } from "../../lib/label-code";

describe("código de etiqueta física", () => {
  it("prioriza Clave 1 de SICAR sobre el código interno", () => {
    expect(
      printableLabelCode({
        legacySicarCode: "17996",
        primaryBarcode: "2000010000265",
      }),
    ).toBe("17996");
  });

  it("usa el código propio cuando el producto no viene de SICAR", () => {
    expect(printableLabelCode({ primaryBarcode: "2000010000265" })).toBe(
      "2000010000265",
    );
  });
});
