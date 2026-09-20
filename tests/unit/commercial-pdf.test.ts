import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { createCommercialPdf } from "../../lib/commercial-pdf";

describe("PDF comercial", () => {
  it("genera una cotización formal tamaño A4 con descuento", async () => {
    const result = await createCommercialPdf({
      kind: "QUOTE",
      folio: "LAP-COT-000123",
      date: "20/09/2026",
      locationName: "La Piedad",
      address: "Av. Mariano Jiménez 706, La Piedad, Michoacán",
      phone: "352 145 6880",
      customerName: "Empresa de prueba",
      customerEmail: "compras@empresa.test",
      validUntil: "27/09/2026",
      notes: "Precios expresados en pesos mexicanos.",
      lines: [
        {
          description: "Bota vaquera piel de avestruz",
          code: "17996",
          quantity: 2,
          unitPriceCents: 290000,
          lineTotalCents: 580000,
        },
      ],
      subtotalCents: 580000,
      discountCents: 30000,
      totalCents: 550000,
    });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const document = await PDFDocument.load(bytes);
    const page = document.getPage(0);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(document.getPageCount()).toBe(1);
    expect(page.getWidth()).toBeCloseTo(595.28, 2);
    expect(page.getHeight()).toBeCloseTo(841.89, 2);
    expect(result.fileName).toBe("cotizacion-LAP-COT-000123.pdf");
  });
});
