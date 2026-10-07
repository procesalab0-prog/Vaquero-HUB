import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  createCommercialPdf,
  type CommercialPdfData,
} from "@/lib/commercial-pdf";

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

const data: CommercialPdfData = {
  kind: "QUOTE",
  folio: "QA-COT-000001",
  date: "01/10/2026",
  locationName: "La Piedad",
  customerName: "Empresa sin registro",
  subtotalCents: 18000,
  discountCents: 1000,
  totalCents: 17000,
  lines: [
    {
      description: "Bota café talla 27.5",
      code: "00017996",
      quantity: 2,
      unitPriceCents: 9000,
      originalUnitPriceCents: 10000,
      discountCents: 1000,
      lineTotalCents: 17000,
    },
  ],
};
describe("documentos comerciales", () => {
  it("genera el importe autorizado sin mutar sus datos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    try {
      const before = JSON.stringify(data);
      const result = await createCommercialPdf(data);
      const pdf = await PDFDocument.load(await result.blob.arrayBuffer());
      expect(pdf.getPageCount()).toBe(1);
      expect(result.fileName).toBe("cotizacion-QA-COT-000001.pdf");
      expect(JSON.stringify(data)).toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("pagina todos los renglones de una cotización larga", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    try {
      const result = await createCommercialPdf({
        ...data,
        subtotalCents: 1800000,
        discountCents: 100000,
        totalCents: 1700000,
        lines: Array.from({ length: 100 }, (_, i) => ({
          ...data.lines[0],
          description: `Producto ${i + 1} ${"Descripción extensa ".repeat(4)}`,
        })),
      });
      const pdf = await PDFDocument.load(await result.blob.arrayBuffer());
      expect(pdf.getPageCount()).toBeGreaterThan(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rechaza un total inconsistente", async () => {
    await expect(
      createCommercialPdf({ ...data, totalCents: 1 }),
    ).rejects.toThrow("INVALID_COMMERCIAL_DOCUMENT");
  });
});
