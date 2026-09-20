"use client";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type CommercialPdfLine = {
  description: string;
  code: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type CommercialPdfData = {
  kind: "QUOTE" | "SALE";
  folio: string;
  date: string;
  locationName: string;
  address?: string | null;
  phone?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  lines: CommercialPdfLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
};

const pesos = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const clean = (value: string) =>
  value.replace(/[\u2010-\u2015]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
const money = (cents: number) => pesos.format(cents / 100);

function safeName(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function wrapText(
  value: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  maxWidth: number,
) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !current)
      current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function createCommercialPdf(data: CommercialPdfData) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.1, 0.09);
  const accent = rgb(0.56, 0.16, 0.11);
  const muted = rgb(0.38, 0.34, 0.31);
  const left = 48;
  const right = 547;
  let y = 785;

  try {
    const response = await fetch("/brand/logo-vaquerosm-negro.png", {
      cache: "force-cache",
    });
    if (response.ok) {
      const logo = await pdf.embedPng(await response.arrayBuffer());
      const size = logo.scaleToFit(125, 62);
      page.drawImage(logo, { x: left, y: y - size.height + 8, ...size });
    }
  } catch {
    // El título textual conserva la identidad si el recurso no está disponible.
  }

  page.drawText(data.kind === "QUOTE" ? "COTIZACION" : "COMPROBANTE DE VENTA", {
    x: 310,
    y,
    size: 18,
    font: bold,
    color: accent,
  });
  y -= 25;
  page.drawText(clean(data.folio), {
    x: 310,
    y,
    size: 11,
    font: bold,
    color: ink,
  });
  y -= 17;
  page.drawText(clean(data.date), {
    x: 310,
    y,
    size: 9,
    font: regular,
    color: muted,
  });
  y -= 45;

  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1.2,
    color: accent,
  });
  y -= 24;
  page.drawText(
    `VAQUERO SM - SUCURSAL ${clean(data.locationName).toUpperCase()}`,
    {
      x: left,
      y,
      size: 10,
      font: bold,
      color: ink,
    },
  );
  y -= 15;
  if (data.address)
    wrapText(data.address, regular, 8.5, 225)
      .slice(0, 2)
      .forEach((line, index) =>
        page.drawText(line, {
          x: left,
          y: y - index * 12,
          size: 8.5,
          font: regular,
          color: muted,
        }),
      );
  const businessBottom = y - (data.address ? 26 : 0);
  if (data.phone) {
    page.drawText(`Tel. ${clean(data.phone)}`, {
      x: left,
      y: businessBottom,
      size: 8.5,
      font: regular,
      color: muted,
    });
  }
  wrapText(`Cliente: ${data.customerName || "Publico general"}`, bold, 9, 205)
    .slice(0, 2)
    .forEach((line, index) =>
      page.drawText(line, {
        x: 335,
        y: y - index * 12,
        size: 9,
        font: bold,
        color: ink,
      }),
    );
  if (data.customerEmail)
    page.drawText(clean(data.customerEmail), {
      x: 335,
      y: y - 28,
      size: 8.5,
      font: regular,
      color: muted,
    });
  if (data.validUntil)
    page.drawText(`Vigencia: ${clean(data.validUntil)}`, {
      x: 335,
      y: y - 42,
      size: 8.5,
      font: regular,
      color: muted,
    });
  y -= 62;

  page.drawRectangle({
    x: left,
    y: y - 5,
    width: right - left,
    height: 24,
    color: accent,
  });
  const headers = [
    ["Descripcion", left + 8],
    ["Cant.", 355],
    ["P. unitario", 410],
    ["Importe", 490],
  ] as const;
  headers.forEach(([label, x]) =>
    page.drawText(label, {
      x,
      y: y + 3,
      size: 8.5,
      font: bold,
      color: rgb(1, 1, 1),
    }),
  );
  y -= 28;

  for (const line of data.lines) {
    if (y < 155) break;
    page.drawText(clean(line.description).slice(0, 52), {
      x: left + 8,
      y,
      size: 8.5,
      font: bold,
      color: ink,
    });
    page.drawText(clean(line.code).slice(0, 35), {
      x: left + 8,
      y: y - 12,
      size: 7.5,
      font: regular,
      color: muted,
    });
    page.drawText(String(line.quantity), {
      x: 367,
      y,
      size: 8.5,
      font: regular,
      color: ink,
    });
    page.drawText(money(line.unitPriceCents), {
      x: 410,
      y,
      size: 8.5,
      font: regular,
      color: ink,
    });
    page.drawText(money(line.lineTotalCents), {
      x: 490,
      y,
      size: 8.5,
      font: bold,
      color: ink,
    });
    y -= 31;
    page.drawLine({
      start: { x: left, y: y + 11 },
      end: { x: right, y: y + 11 },
      thickness: 0.35,
      color: rgb(0.82, 0.8, 0.77),
    });
  }

  y -= 4;
  const totalRow = (label: string, value: string, strong = false) => {
    page.drawText(label, {
      x: 390,
      y,
      size: strong ? 12 : 9,
      font: strong ? bold : regular,
      color: ink,
    });
    page.drawText(value, {
      x: 485,
      y,
      size: strong ? 12 : 9,
      font: strong ? bold : regular,
      color: strong ? accent : ink,
    });
    y -= strong ? 22 : 16;
  };
  totalRow("Subtotal", money(data.subtotalCents));
  totalRow("Descuento", `-${money(data.discountCents)}`);
  totalRow("TOTAL", money(data.totalCents), true);
  if (data.notes) {
    y -= 8;
    page.drawText("Observaciones", {
      x: left,
      y,
      size: 9,
      font: bold,
      color: ink,
    });
    y -= 14;
    page.drawText(clean(data.notes).slice(0, 130), {
      x: left,
      y,
      size: 8.5,
      font: regular,
      color: muted,
    });
  }
  page.drawText("Documento generado por Mi Tienda SM", {
    x: left,
    y: 48,
    size: 8,
    font: regular,
    color: muted,
  });
  page.drawText("vaquerosm.com", {
    x: 455,
    y: 48,
    size: 8,
    font: bold,
    color: accent,
  });

  const bytes = await pdf.save({ useObjectStreams: true });
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    fileName: `${data.kind === "QUOTE" ? "cotizacion" : "comprobante"}-${safeName(data.folio)}.pdf`,
  };
}

export function downloadCommercialPdf(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
