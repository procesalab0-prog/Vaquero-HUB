import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { createTicketPdf } from "../../lib/ticket-pdf";

const ticket = {
  folio: "V-TEST-0001",
  soldAt: "15/09/2026 18:30",
  locationName: "La Piedad",
  address: "Av. Mariano Jiménez 706, La Piedad, Michoacán",
  phone: "352 145 6880",
  cashierName: "Salomon",
  registerName: "Caja 01",
  lines: [
    {
      name: "Bota vaquera",
      variant: "Café / 27",
      code: "1000001-0",
      quantity: 1,
      unitPriceCents: 199900,
    },
  ],
  subtotalCents: 199900,
  discountCents: 0,
  totalCents: 199900,
  payments: [
    { methodName: "Efectivo", amountCents: 99900 },
    { methodName: "Tarjeta", amountCents: 100000 },
  ],
  returnWindowDays: 15,
};

describe("ticket PDF", () => {
  it("genera un PDF térmico válido de 80 mm con pagos divididos", async () => {
    const result = await createTicketPdf({ ...ticket, mode: "sale" });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const document = await PDFDocument.load(bytes);
    const page = document.getPage(0);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(document.getPageCount()).toBe(1);
    expect(page.getWidth()).toBeCloseTo((80 * 72) / 25.4, 2);
    expect(result.fileName).toBe("ticket-V-TEST-0001.pdf");
  });

  it("genera una copia de regalo separada", async () => {
    const result = await createTicketPdf({ ...ticket, mode: "gift" });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(1);
    expect(result.fileName).toBe("ticket-regalo-R-TEST-0001-1.pdf");
  });
});
