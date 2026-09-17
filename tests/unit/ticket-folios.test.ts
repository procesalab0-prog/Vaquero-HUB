import { describe, expect, it } from "vitest";

import {
  giftFolioFromSale,
  saleFolioFromReceiptCode,
} from "../../lib/ticket-folios";

describe("folios de ticket de regalo", () => {
  it("recupera una venta con folio corto desde el código de regalo", () => {
    const gift = giftFolioFromSale("V-000842");

    expect(gift).toBe("R-000842-1");
    expect(saleFolioFromReceiptCode(gift)).toBe("V-000842");
  });

  it("recupera una venta real con prefijo de sucursal", () => {
    const gift = giftFolioFromSale("LAP-V-000142");

    expect(gift).toBe("R-LAP-V-000142-1");
    expect(saleFolioFromReceiptCode(gift)).toBe("LAP-V-000142");
  });

  it("conserva sin cambios el folio de una venta normal", () => {
    expect(saleFolioFromReceiptCode(" lap-v-000142 ")).toBe("LAP-V-000142");
  });
});
