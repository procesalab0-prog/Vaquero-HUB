import { PDFDocument } from "pdf-lib";
import { describe, it, expect } from "vitest";
import {
  createPurchasePdf,
  defaultPurchasePdfFields,
  supplierWhatsAppUrl,
  type PurchasePdfData,
} from "../../lib/purchase-pdf";

const data: PurchasePdfData = {
  folio: 19,
  date: "01/10/2026",
  status: "Pendiente",
  locationName: "La Piedad",
  supplierName: "Proveedor de prueba",
  fields: { ...defaultPurchasePdfFields },
  notes: "No modifica el inventario",
  terms: "A convenir",
  taxes: "Costos proporcionados por el proveedor",
  lines: [
    {
      description: "Bota vaquera café talla 27.5",
      code: "00017996",
      quantity: 2,
      unitCostCents: 123450,
    },
  ],
};
describe("PDF de orden de compra", () => {
  it("admite cantidades fraccionarias sólo en su unidad y conserva centavos por renglón", async () => {
    const unit = { code: "KILO", name: "Kilo", decimal_places: 3 as const };
    const result = await createPurchasePdf({
      ...data,
      lines: [
        {
          ...data.lines[0],
          quantity: 1.25,
          unitCostCents: 12345,
          measureUnit: unit,
        },
        {
          ...data.lines[0],
          quantity: 0.625,
          unitCostCents: 12345,
          measureUnit: unit,
        },
      ],
    });
    expect(result.blob.size).toBeGreaterThan(100);
    await expect(
      createPurchasePdf({
        ...data,
        lines: [{ ...data.lines[0], quantity: 0.625 }],
      }),
    ).rejects.toThrow("INVALID_ORDER_LINE");
    await expect(
      createPurchasePdf({
        ...data,
        lines: [{ ...data.lines[0], quantity: 0.0001, measureUnit: unit }],
      }),
    ).rejects.toThrow("INVALID_ORDER_LINE");
  });
  it("genera A4 sin cambiar los datos ni la selección", async () => {
    const before = JSON.stringify(data);
    const result = await createPurchasePdf(data);
    const pdf = await PDFDocument.load(await result.blob.arrayBuffer());
    expect(result.fileName).toBe("orden-compra-19.pdf");
    expect(pdf.getTitle()).toBe("Orden de compra #19");
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28);
    expect(JSON.stringify(data)).toBe(before);
  });
  it("pagina órdenes largas en lugar de omitir productos", async () => {
    const result = await createPurchasePdf({
      ...data,
      lines: Array.from({ length: 100 }, (_, index) => ({
        ...data.lines[0],
        description: `Producto ${index + 1} - ${"Descripción extensa ".repeat(4)}`,
      })),
    });
    const pdf = await PDFDocument.load(await result.blob.arrayBuffer());
    expect(pdf.getPageCount()).toBeGreaterThan(5);
  });
  it("permite ocultar campos opcionales y rechaza cantidades imposibles", async () => {
    const result = await createPurchasePdf({
      ...data,
      fields: Object.fromEntries(
        Object.keys(defaultPurchasePdfFields).map((key) => [key, false]),
      ) as PurchasePdfData["fields"],
    });
    expect(result.blob.size).toBeGreaterThan(100);
    await expect(
      createPurchasePdf({
        ...data,
        lines: [{ ...data.lines[0], quantity: 0 }],
      }),
    ).rejects.toThrow("INVALID_ORDER_LINE");
  });
  it("normaliza teléfono mexicano y no inventa teléfonos inválidos", () => {
    expect(supplierWhatsAppUrl("352-145-6880", 19)).toMatch(
      /^https:\/\/wa.me\/523521456880\?text=/,
    );
    expect(supplierWhatsAppUrl("+1 (555) 123-4567", 19)).toMatch(
      /\/15551234567\?/,
    );
    expect(supplierWhatsAppUrl("3521456880 ext. 2", 19)).toBeNull();
    expect(supplierWhatsAppUrl("", 19)).toBeNull();
  });
});
