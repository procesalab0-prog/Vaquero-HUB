"use client";

export type CommercialPdfLine = {
  description: string;
  code: string;
  quantity: number;
  unitPriceCents: number;
  originalUnitPriceCents?: number;
  discountCents?: number;
  lineTotalCents: number;
};
export type CommercialPdfData = {
  usdTender?: import('@/components/thermal-receipt').UsdReceiptTender | null;
  kind: "QUOTE" | "SALE"; folio: string; date: string; locationName: string;
  address?: string | null; phone?: string | null; customerName?: string | null;
  customerEmail?: string | null; validUntil?: string | null; notes?: string | null;
  lines: CommercialPdfLine[]; subtotalCents: number; discountCents: number; totalCents: number;
};
export async function createCommercialPdf(data: CommercialPdfData) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const integerMoney = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (![data.subtotalCents, data.discountCents, data.totalCents].every(integerMoney)
      || data.totalCents !== data.subtotalCents - data.discountCents
      || !data.lines.length
      || data.lines.some(line => !integerMoney(line.unitPriceCents) || !integerMoney(line.lineTotalCents) || !Number.isFinite(line.quantity) || line.quantity <= 0))
    throw new Error("INVALID_COMMERCIAL_DOCUMENT");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.08, 0.08), muted = rgb(0.35, 0.35, 0.35), cream = rgb(0.94, 0.92, 0.87);
  const title = data.kind === "QUOTE" ? "COTIZACION" : "COMPROBANTE DE VENTA";
  const clean = (value: string) => value.replace(/\s+/g, " ").replace(/[\u2010-\u2015]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value / 100);
  const wrap = (value: string, width: number, size: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of clean(value).split(/\s+/).filter(Boolean)) {
      if (bold.widthOfTextAtSize(line ? line + " " + word : word, size) <= width) {
        line = line ? line + " " + word : word;
      } else {
        if (line) { lines.push(line); line = ""; }
        for (const letter of word) {
          if (line && bold.widthOfTextAtSize(line + letter, size) > width) { lines.push(line); line = ""; }
          line += letter;
        }
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  let page = pdf.addPage([595.28, 841.89]), y = 790;
  const nextPage = () => {
    page = pdf.addPage([595.28, 841.89]); y = 790;
    page.drawText(clean(title + " - " + data.folio + " (continuacion)"), { x: 48, y, size: 9, font: bold, color: ink });
    y -= 28;
  };
  const ensure = (height: number) => { if (y - height < 65) nextPage(); };
  const text = (value: string, strong = false) => {
    for (const line of wrap(value, 499, 10)) {
      ensure(16); page.drawText(line, { x: 48, y, size: 10, font: strong ? bold : font, color: ink }); y -= 15;
    }
  };
  try {
    const response = await fetch("/brand/logo-vaquerosm-negro.png", { cache: "force-cache" });
    if (response.ok) {
      const logo = await pdf.embedPng(await response.arrayBuffer());
      const dimensions = logo.scaleToFit(145, 65);
      page.drawImage(logo, { x: 48, y: y - dimensions.height, ...dimensions }); y -= 80;
    }
  } catch { /* Textual identity remains visible if the logo is unavailable. */ }
  text(title, true); text("Folio: " + data.folio); text("Fecha: " + data.date);
  text("VAQUERO SM - " + data.locationName, true);
  if (data.address) text(data.address);
  if (data.phone) text("Tel. " + data.phone);
  y -= 10; text("Cliente: " + (data.customerName || "Publico general"), true);
  if (data.customerEmail) text(data.customerEmail);
  if (data.validUntil) text("Vigencia: " + data.validUntil);
  y -= 20;
  const heading = () => {
    ensure(35); page.drawRectangle({ x: 48, y: y - 6, width: 499, height: 24, color: cream });
    for (const [label, x] of [["Producto", 55], ["Cant.", 315], ["P. unitario", 378], ["Importe MXN", 462]] as const)
      page.drawText(label, { x, y, size: 9, font: bold, color: ink });
    y -= 30;
  };
  heading();
  for (const line of data.lines) {
    const descriptions = wrap(line.description, 245, 10);
    const details = [
      ...wrap(line.code, 245, 8),
      ...(line.originalUnitPriceCents !== undefined ? wrap("Original: " + money(line.originalUnitPriceCents) + " | Cotizado: " + money(line.unitPriceCents), 245, 8) : []),
      ...(line.discountCents !== undefined ? wrap("Descuento del renglon: " + money(line.discountCents), 245, 8) : []),
    ];
    const height = descriptions.length * 15 + details.length * 12 + 15;
    if (y - Math.min(height, 600) < 65) { nextPage(); heading(); }
    page.drawText(String(line.quantity), { x: 320, y, size: 9, font, color: ink });
    for (const [value, right] of [[money(line.unitPriceCents), 439], [money(line.lineTotalCents), 547]] as const) {
      const size = Math.min(9, 9 * 80 / font.widthOfTextAtSize(value, 9));
      page.drawText(value, { x: right - font.widthOfTextAtSize(value, size), y, size, font, color: ink });
    }
    for (const description of descriptions) {
      ensure(15); page.drawText(description, { x: 55, y, size: 10, font: bold, color: ink }); y -= 15;
    }
    for (const detail of details) {
      ensure(12); page.drawText(detail, { x: 55, y, size: 8, font, color: muted }); y -= 12;
    }
    y -= 15;
  }
  ensure(85);
  text("Subtotal: " + money(data.subtotalCents));
  text("Descuento: -" + money(data.discountCents));
  text("TOTAL: " + money(data.totalCents) + " MXN", true);
  if (data.kind === 'SALE' && data.usdTender) {
    const usd = data.usdTender;
    text('Recibido USD: ' + (Number(usd.received_usd_cents)/100).toFixed(2));
    text('Tasa MXN / USD: ' + Number(usd.rate_million)/1000000);
    text('Equivalente MXN: ' + money(Number(usd.equivalent_mxn_cents)));
    text('Cambio MXN: ' + money(Number(usd.change_mxn_cents)));
  }
  if (data.notes) { y -= 12; text("Observaciones: " + data.notes); }
  y -= 12;
  text(data.kind === "QUOTE" ? "Cotizacion: no reserva mercancia ni acredita un pago." : "Comprobante de venta. No es una factura fiscal.");
  pdf.getPages().forEach((sheet, index, pages) => sheet.drawText("Vaquero SM | Pagina " + (index + 1) + " de " + pages.length, { x: 48, y: 32, size: 8, font, color: muted }));
  const bytes = await pdf.save();
  return { blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    fileName: (data.kind === "QUOTE" ? "cotizacion" : "comprobante") + "-" + data.folio.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") + ".pdf" };
}
export function downloadCommercialPdf(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
