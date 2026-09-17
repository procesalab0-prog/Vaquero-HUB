"use client";

import JsBarcode from "jsbarcode";

import { giftFolioFromSale } from "./ticket-folios";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export type TicketPdfLine = {
  name: string;
  variant: string;
  code: string;
  quantity: number;
  unitPriceCents: number;
};

export type TicketPdfPayment = {
  methodName: string;
  amountCents: number;
  reference?: string | null;
};

export type TicketPdfData = {
  mode: "sale" | "gift";
  folio: string;
  soldAt: string;
  locationName: string;
  address?: string | null;
  phone?: string | null;
  cashierName?: string | null;
  registerName?: string | null;
  lines: TicketPdfLine[];
  subtotalCents?: number;
  discountCents?: number;
  totalCents?: number;
  payments?: TicketPdfPayment[];
  returnWindowDays: number;
  logoPng?: Uint8Array;
};

const MM = 72 / 25.4;
const PAGE_WIDTH = 80 * MM;
const MARGIN = 5 * MM;
const pesos = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function printable(value: string) {
  return value
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function money(cents = 0) {
  return `$${pesos.format(cents / 100)}`;
}

function barcodeBits(code: string) {
  const target = {} as { encodings?: Array<{ data: string }> };
  JsBarcode(target as unknown as SVGElement, code, {
    format: "CODE128",
    displayValue: false,
    margin: 0,
  });
  return target.encodings?.map((encoding) => encoding.data).join("") ?? "";
}

async function loadLogo(data: TicketPdfData) {
  if (data.logoPng) return data.logoPng;
  if (typeof window === "undefined") return null;
  try {
    const response = await fetch("/brand/logo-vaquerosm-negro.png", {
      cache: "force-cache",
    });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = printable(text).split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      rows.push(current);
      current = word;
    }
  }
  if (current) rows.push(current);
  return rows.length ? rows : [""];
}

export async function createTicketPdf(data: TicketPdfData) {
  const receiptFolio =
    data.mode === "gift" ? giftFolioFromSale(data.folio) : data.folio;
  const logoBytes = await loadLogo(data);
  const logoHeightAllowanceMm = logoBytes ? 11 : 0;
  const heightMm = Math.max(
    150 + logoHeightAllowanceMm,
    131 +
      logoHeightAllowanceMm +
      data.lines.length * (data.mode === "sale" ? 15 : 11) +
      (data.payments?.length ?? 0) * 7,
  );
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, heightMm * MM]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const width = page.getWidth();
  let y = page.getHeight() - 8 * MM;

  const centered = (text: string, size: number, font = regular) => {
    const value = printable(text);
    page.drawText(value, {
      x: (width - font.widthOfTextAtSize(value, size)) / 2,
      y,
      size,
      font,
      color: rgb(0.08, 0.08, 0.08),
    });
  };
  const leftRight = (
    left: string,
    right: string,
    size = 7.5,
    font = regular,
  ) => {
    const leftValue = printable(left);
    const rightValue = printable(right);
    page.drawText(leftValue, { x: MARGIN, y, size, font });
    page.drawText(rightValue, {
      x: width - MARGIN - font.widthOfTextAtSize(rightValue, size),
      y,
      size,
      font,
    });
  };
  const rule = () =>
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: width - MARGIN, y },
      thickness: 0.5,
      color: rgb(0.3, 0.3, 0.3),
    });
  const wrappedCentered = (text: string, size: number, font = regular) => {
    for (const row of wrapText(text, font, size, width - MARGIN * 2)) {
      centered(row, size, font);
      y -= size + 2;
    }
  };

  if (logoBytes) {
    const logo = await pdf.embedPng(logoBytes);
    const logoSize = logo.scaleToFit(50 * MM, 30 * MM);
    page.drawImage(logo, {
      x: (width - logoSize.width) / 2,
      y: y - logoSize.height,
      width: logoSize.width,
      height: logoSize.height,
    });
    y -= logoSize.height + 3 * MM;
  } else {
    centered("VAQUERO SM", 15, bold);
    y -= 19;
  }
  centered(`SUCURSAL ${data.locationName.toLocaleUpperCase("es-MX")}`, 8, bold);
  y -= 12;
  if (data.mode === "sale" && data.address) wrappedCentered(data.address, 7);
  if (data.mode === "sale" && data.phone) {
    centered(`Tel. ${data.phone}`, 7);
    y -= 11;
  }
  if (data.mode === "gift") {
    centered("TICKET DE REGALO", 10, bold);
    y -= 17;
  }

  rule();
  y -= 13;
  page.drawText(`Folio: ${printable(receiptFolio)}`, {
    x: MARGIN,
    y,
    size: 7.5,
    font: regular,
  });
  y -= 11;
  page.drawText(`Fecha: ${printable(data.soldAt)}`, {
    x: MARGIN,
    y,
    size: 7.5,
    font: regular,
  });
  y -= 11;
  if (data.mode === "sale" && data.cashierName) {
    page.drawText(`Cajero: ${printable(data.cashierName)}`, {
      x: MARGIN,
      y,
      size: 7.5,
      font: regular,
    });
    y -= 11;
  }
  if (data.mode === "sale" && data.registerName) {
    page.drawText(`Caja: ${printable(data.registerName)}`, {
      x: MARGIN,
      y,
      size: 7.5,
      font: regular,
    });
    y -= 11;
  }
  rule();
  y -= 13;

  for (const line of data.lines) {
    for (const row of wrapText(
      `${line.name.toLocaleUpperCase("es-MX")} - ${line.variant.toLocaleUpperCase("es-MX")}`,
      bold,
      7.5,
      width - MARGIN * 2,
    )) {
      page.drawText(row, { x: MARGIN, y, size: 7.5, font: bold });
      y -= 10;
    }
    if (data.mode === "sale") {
      leftRight(
        `${line.quantity} x ${money(line.unitPriceCents)}  ${line.code}`,
        money(line.quantity * line.unitPriceCents),
        7,
      );
    } else {
      page.drawText(`${line.quantity} pza.  ${printable(line.code)}`, {
        x: MARGIN,
        y,
        size: 7,
        font: regular,
      });
    }
    y -= 13;
  }

  rule();
  y -= 13;
  if (data.mode === "sale") {
    leftRight("Subtotal", money(data.subtotalCents));
    y -= 12;
    leftRight("Descuento", `-${money(data.discountCents)}`);
    y -= 15;
    leftRight("TOTAL", money(data.totalCents), 11, bold);
    y -= 16;
    for (const payment of data.payments ?? []) {
      leftRight(payment.methodName, money(payment.amountCents));
      y -= 10;
      if (payment.reference) {
        page.drawText(`Referencia: ${printable(payment.reference)}`, {
          x: MARGIN + 5,
          y,
          size: 6.5,
          font: regular,
        });
        y -= 10;
      }
    }
  }

  y -= 3;
  const barcode = barcodeBits(receiptFolio);
  if (barcode) {
    const barcodeX = 13 * MM;
    const barcodeY = y - 13 * MM;
    const quietZone = 3 * MM;
    const moduleWidth = (54 * MM - quietZone * 2) / barcode.length;
    for (let index = 0; index < barcode.length; index += 1) {
      if (barcode[index] !== "1") continue;
      page.drawRectangle({
        x: barcodeX + quietZone + index * moduleWidth,
        y: barcodeY,
        width: moduleWidth + 0.05,
        height: 13 * MM,
        color: rgb(0, 0, 0),
      });
    }
    y -= 17 * MM;
  }
  const folioWidth = mono.widthOfTextAtSize(receiptFolio, 8);
  page.drawText(receiptFolio, {
    x: (width - folioWidth) / 2,
    y,
    size: 8,
    font: mono,
  });
  y -= 16;
  const policy =
    data.mode === "gift"
      ? `Presenta este ticket para cambio de talla o modelo dentro de ${data.returnWindowDays} días. No incluye importes ni forma de pago.`
      : `Cambios y devoluciones dentro de ${data.returnWindowDays} días con este ticket y etiqueta original. No aplica en oferta.`;
  wrappedCentered(policy, 6.8);
  y -= 3;
  centered("GRACIAS POR SU COMPRA", 8, bold);

  const bytes = await pdf.save({ useObjectStreams: true });
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  return {
    blob,
    fileName: `${data.mode === "gift" ? "ticket-regalo" : "ticket"}-${safeFilePart(receiptFolio)}.pdf`,
  };
}

export function downloadTicketPdf(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
