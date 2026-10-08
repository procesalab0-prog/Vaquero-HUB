import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFPage } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { createTicketPdf } from "@/lib/ticket-pdf";
import { createCommercialPdf } from "@/lib/commercial-pdf";

const usdTender = {
  received_usd_cents: 550,
  rate_million: 20000000,
  equivalent_mxn_cents: 11000,
  change_mxn_cents: 1000,
};
const receipt = {
  folio: "QA-V-000001",
  soldAt: "02/10/2026 12:00",
  locationName: "La Piedad",
  returnWindowDays: 15,
  subtotalCents: 10000,
  discountCents: 0,
  totalCents: 10000,
  usdTender,
  lines: [
    {
      name: "Bota prueba",
      variant: "Talla 27",
      code: "17996",
      quantity: 1,
      unitPriceCents: 10000,
    },
  ],
  payments: [{ methodName: "Dólares", amountCents: 10000 }],
};
afterEach(() => vi.restoreAllMocks());
describe("documentos USD", () => {
  it("imprime recibido, tasa y cambio MXN en el PDF térmico, sin cortar el pie", async () => {
    const spy = vi.spyOn(PDFPage.prototype, "drawText");
    const result = await createTicketPdf({ ...receipt, mode: "sale" });
    expect(spy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["Recibido USD", "Tasa MXN / USD", "Cambio MXN"]),
    );
    expect(spy.mock.calls.every((c) => (c[1]?.y ?? 0) >= 0)).toBe(true);
    if (process.env.PDF_QA_DIRECTORY)
      await writeFile(
        process.env.PDF_QA_DIRECTORY + "/usd-ticket.pdf",
        new Uint8Array(await result.blob.arrayBuffer()),
      );
  });
  it("no filtra dólares, tasa ni importes al ticket de regalo", async () => {
    const spy = vi.spyOn(PDFPage.prototype, "drawText");
    await createTicketPdf({ ...receipt, mode: "gift" });
    expect(spy.mock.calls.map((c) => c[0]).join(" ")).not.toMatch(
      /Recibido USD|Tasa MXN|Cambio MXN|110\.00|100\.00/,
    );
  });
  it("incluye la conciliación en el comprobante formal A4", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("QA offline")));
    try {
      const spy = vi.spyOn(PDFPage.prototype, "drawText");
      const result = await createCommercialPdf({
        kind: "SALE",
        folio: receipt.folio,
        date: receipt.soldAt,
        locationName: receipt.locationName,
        usdTender,
        subtotalCents: 10000,
        discountCents: 0,
        totalCents: 10000,
        lines: [
          {
            description: "Bota prueba Talla 27",
            code: "17996",
            quantity: 1,
            unitPriceCents: 10000,
            lineTotalCents: 10000,
          },
        ],
      });
      expect(spy.mock.calls.map((c) => c[0]).join(" ")).toContain(
        "Cambio MXN: $10.00",
      );
      if (process.env.PDF_QA_DIRECTORY)
        await writeFile(
          process.env.PDF_QA_DIRECTORY + "/usd-comprobante.pdf",
          new Uint8Array(await result.blob.arrayBuffer()),
        );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
