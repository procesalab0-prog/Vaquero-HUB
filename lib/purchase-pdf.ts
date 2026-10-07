import {
  measureLineCents,
  quantityUnit,
  type MeasureUnit,
} from "./measure-units";

export const purchasePdfFields = {
  logo: "Logo",
  business: "Datos de la tienda",
  supplier: "Datos del proveedor",
  folio: "Folio",
  date: "Fecha",
  destination: "Sucursal de destino",
  codes: "Códigos",
  costs: "Costos unitarios",
  total: "Total",
  notes: "Notas",
  delivery: "Entrega prevista",
  terms: "Condiciones de pago",
  taxes: "Información de impuestos",
} as const;
export type PurchasePdfFields = Record<keyof typeof purchasePdfFields, boolean>;
export const defaultPurchasePdfFields: PurchasePdfFields = Object.fromEntries(
  Object.keys(purchasePdfFields).map((key) => [key, true]),
) as PurchasePdfFields;
export type PurchasePdfData = {
  folio: number;
  date: string;
  status: string;
  locationName: string;
  address?: string | null;
  phone?: string | null;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierEmail?: string;
  supplierTaxId?: string;
  notes?: string | null;
  delivery?: string | null;
  terms?: string;
  taxes?: string;
  lines: Array<{
    description: string;
    code: string;
    quantity: number;
    unitCostCents: number;
    measureUnit?: MeasureUnit;
  }>;
  fields: PurchasePdfFields;
  logoBytes?: Uint8Array;
};

export function supplierWhatsAppUrl(phone: string, folio: number) {
  if (!/^[+\d\s().-]+$/.test(phone)) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `52${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Te comparto la orden de compra #${folio} de Vaquero SM. Adjunto el PDF con los productos solicitados.`)}`;
}

/** Presentation only: quantities and costs come from the existing order, never a mutation. */
export async function createPurchasePdf(data: PurchasePdfData) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Orden de compra #${data.folio}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.08, 0.08);
  const muted = rgb(0.35, 0.35, 0.35);
  const cream = rgb(0.94, 0.92, 0.87);
  const clean = (text: string) =>
    text
      .replace(/\s+/g, " ")
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const money = (value: number) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(value / 100);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const nextPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = 790;
    page.drawText("VAQUERO SM - ORDEN DE COMPRA (continuación)", {
      x: 48,
      y,
      size: 9,
      font: bold,
      color: ink,
    });
    y -= 28;
  };
  const ensure = (height: number) => {
    if (y - height < 65) nextPage();
  };
  const wrap = (value: string, width: number, size = 10) => {
    const result: string[] = [];
    let line = "";
    for (const word of clean(value).split(/\s+/).filter(Boolean)) {
      const combined = line ? `${line} ${word}` : word;
      if (bold.widthOfTextAtSize(combined, size) <= width) {
        line = combined;
        continue;
      }
      if (line) {
        result.push(line);
        line = "";
      }
      // Only break tokens that cannot fit at all (long SKUs or emails).
      for (const character of word) {
        if (line && bold.widthOfTextAtSize(line + character, size) > width) {
          result.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line.trim()) result.push(line.trim());
    return result;
  };
  const text = (value: string, strong = false) => {
    for (const line of wrap(value, 499)) {
      ensure(16);
      page.drawText(line, {
        x: 48,
        y,
        size: 10,
        font: strong ? bold : font,
        color: ink,
      });
      y -= 15;
    }
  };
  if (data.fields.logo && data.logoBytes) {
    const logo = await pdf.embedPng(data.logoBytes);
    const dimensions = logo.scaleToFit(145, 65);
    page.drawImage(logo, { x: 48, y: y - dimensions.height, ...dimensions });
    y -= 80;
  }
  text("ORDEN DE COMPRA", true);
  if (data.fields.folio) text(`Folio: #${data.folio}`);
  if (data.fields.date) text(`Fecha: ${data.date}`);
  text(`Estado: ${data.status}`);
  if (data.fields.business) {
    text("Vaquero SM", true);
    if (data.address) text(data.address);
    if (data.phone) text(`Teléfono: ${data.phone}`);
  }
  if (data.fields.destination) text(`Destino: ${data.locationName}`);
  if (data.fields.supplier) {
    y -= 10;
    text(`Proveedor: ${data.supplierName}`, true);
    for (const [label, value] of [
      ["Contacto", data.supplierContact],
      ["Teléfono", data.supplierPhone],
      ["Correo", data.supplierEmail],
      ["RFC", data.supplierTaxId],
    ]) {
      if (value) text(`${label}: ${value}`);
    }
  }
  y -= 20;
  const heading = () => {
    ensure(35);
    page.drawRectangle({
      x: 48,
      y: y - 6,
      width: 499,
      height: 24,
      color: cream,
    });
    for (const [label, x] of [
      ["Producto", 55],
      ["Cantidad", 309],
      ...(data.fields.costs
        ? [
            ["Costo MXN", 379],
            ["Importe MXN", 468],
          ]
        : []),
    ] as Array<[string, number]>) {
      page.drawText(label, { x, y, size: 9, font: bold, color: ink });
    }
    y -= 30;
  };
  heading();
  let totalCents = 0;
  for (const item of data.lines) {
    const unit = quantityUnit(item);
    const lineCents = measureLineCents(item.unitCostCents, item.quantity, unit);
    if (lineCents === null) throw new Error("INVALID_ORDER_LINE");
    totalCents += lineCents;
    if (!Number.isSafeInteger(totalCents))
      throw new Error("INVALID_ORDER_TOTAL");
    const descriptions = wrap(item.description, 246);
    descriptions.push(...wrap(`Unidad: ${unit.name}`, 246));
    const codes = data.fields.codes ? wrap(item.code, 246, 8) : [];
    const height = descriptions.length * 15 + codes.length * 12 + 15;
    if (y - Math.min(height, 600) < 65) {
      nextPage();
      heading();
    }
    const top = y;
    const quantityText = new Intl.NumberFormat("es-MX", {
      maximumFractionDigits: 3,
    }).format(item.quantity);
    const quantitySize = Math.min(
      9,
      (9 * 52) / font.widthOfTextAtSize(quantityText, 9),
    );
    page.drawText(quantityText, {
      x: 320,
      y: top,
      size: quantitySize,
      font,
      color: ink,
    });
    if (data.fields.costs) {
      for (const [value, right] of [
        [money(item.unitCostCents), 440],
        [money(lineCents), 547],
      ] as const) {
        const size = Math.min(9, (9 * 80) / font.widthOfTextAtSize(value, 9));
        page.drawText(value, {
          x: right - font.widthOfTextAtSize(value, size),
          y: top,
          size,
          font,
          color: ink,
        });
      }
    }
    descriptions.forEach((line) => {
      ensure(15);
      page.drawText(line, { x: 55, y, size: 10, font, color: ink });
      y -= 15;
    });
    codes.forEach((line) => {
      ensure(12);
      page.drawText(line, { x: 55, y, size: 8, font, color: muted });
      y -= 12;
    });
    y -= 15;
  }
  if (data.fields.total) {
    y -= 8;
    text(`Total de la orden: ${money(totalCents)} MXN`, true);
  }
  for (const [enabled, label, value] of [
    [data.fields.delivery, "Entrega prevista", data.delivery],
    [data.fields.terms, "Condiciones de pago", data.terms],
    [data.fields.taxes, "Información de impuestos", data.taxes],
    [data.fields.notes, "Notas", data.notes],
  ] as const) {
    if (enabled && value) {
      y -= 12;
      text(`${label}: ${value}`);
    }
  }
  y -= 12;
  text("Documento de solicitud. No acredita recepción ni pago.");
  pdf.getPages().forEach((sheet, index, pages) =>
    sheet.drawText(`Vaquero SM | Página ${index + 1} de ${pages.length}`, {
      x: 48,
      y: 32,
      size: 8,
      font,
      color: muted,
    }),
  );
  const bytes = await pdf.save();
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    fileName: `orden-compra-${data.folio}.pdf`,
  };
}
