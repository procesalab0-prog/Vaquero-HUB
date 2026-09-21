import { describe, expect, it } from "vitest";

import {
  giftFolioFromSale,
  isTicketReceiptCode,
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

  it("corrige los apóstrofes que envía un lector USB en lugar de guiones", () => {
    expect(saleFolioFromReceiptCode("LAP'V'000016")).toBe("LAP-V-000016");
    expect(saleFolioFromReceiptCode("R'LAP'V'000016'1")).toBe("LAP-V-000016");
    expect(isTicketReceiptCode("LAP'V'000016")).toBe(true);
  });

  it("distingue tickets normales y de regalo de códigos de producto", () => {
    expect(isTicketReceiptCode("LAP-V-000142")).toBe(true);
    expect(isTicketReceiptCode("R-LAP-V-000142-1")).toBe(true);
    expect(isTicketReceiptCode("17996")).toBe(false);
    expect(isTicketReceiptCode("2000010000265")).toBe(false);
  });
});
