import Image from "next/image";
import type { WorkspaceLocation } from "@/lib/auth/types";
import { BUSINESS_PROFILE, LA_PIEDAD_STORE } from "@/lib/business-profile";

export type ReceiptLine = {
  name: string;
  variant: string;
  code: string;
  quantity: number;
  unitPrice: number;
};

type ThermalReceiptProps = {
  mode: "sale" | "gift";
  folio: string;
  date: string;
  items: ReceiptLine[];
  subtotal?: number;
  discount?: number;
  total?: number;
  method?: string;
  tendered?: number;
  change?: number;
  reprintLabel?: string;
  cashierName?: string;
  location?: WorkspaceLocation | null;
};

const number = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatReceiptDate(date = new Date()) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(",", "");
}

function saleFolioToGift(folio: string) {
  return `R-${folio.replace(/^V-/, "")}-1`;
}

export function ThermalReceipt({ mode, folio, date, items, subtotal = 0, discount = 0, total = 0, method = "Efectivo", tendered, change = 0, reprintLabel, cashierName = "Salomon", location }: ThermalReceiptProps) {
  const receiptFolio = mode === "gift" ? saleFolioToGift(folio) : folio;
  const receiptLocation = location ?? LA_PIEDAD_STORE;
  const receiptAddress = receiptLocation.address ?? "Dirección por configurar";
  const receiptPhone = receiptLocation.phone ?? "Teléfono por configurar";
  return (
    <article className={`thermal-receipt print-receipt ${mode === "gift" ? "gift-receipt" : "sale-receipt"}`} aria-label={mode === "gift" ? "Vista previa del ticket de regalo" : "Vista previa del ticket de venta"}>
      <header className="receipt-brand">
        <Image src="/brand/logo-vaquerosm-negro.png" alt="Vaquero SM" width={300} height={200} priority />
        {mode === "sale" ? <p>{BUSINESS_PROFILE.name.toLocaleUpperCase("es-MX")} · SUCURSAL {receiptLocation.name.toLocaleUpperCase("es-MX")}<br />{receiptAddress}<br />Tel. {receiptPhone}</p> : null}
      </header>

      {mode === "gift" ? <div className="gift-receipt-title">TICKET DE REGALO</div> : null}

      <section className="receipt-meta">
        <div><span>Folio</span><code>{receiptFolio}</code></div>
        <div><span>Fecha</span><span>{date}</span></div>
        {mode === "sale" ? <><div><span>Cajero</span><span>{cashierName}</span></div><div><span>Caja</span><span>Caja 01</span></div></> : <div><span>Sucursal</span><span>{receiptLocation.name}</span></div>}
        {reprintLabel ? <strong className="reprint-label">REIMPRESIÓN {reprintLabel}</strong> : null}
      </section>

      <section className="thermal-lines">
        {items.map((item, index) => (
          <div className="thermal-line" key={`${item.code}-${index}`}>
            <strong>{item.name.toLocaleUpperCase("es-MX")} · {item.variant.toLocaleUpperCase("es-MX")}</strong>
            {mode === "sale" ? <div><span>{item.quantity} × {number.format(item.unitPrice)} · <code>{item.code}</code></span><b>{number.format(item.quantity * item.unitPrice)}</b></div> : <code>{item.code}</code>}
          </div>
        ))}
      </section>

      {mode === "sale" ? (
        <section className="thermal-totals">
          <div><span>Subtotal ({items.reduce((sum, item) => sum + item.quantity, 0)} art.)</span><span>{number.format(subtotal)}</span></div>
          <div><span>Descuento</span><span>−{number.format(discount)}</span></div>
          <div className="thermal-grand-total"><strong>TOTAL</strong><strong>${number.format(total)}</strong></div>
          <div><span>{method}</span><span>{number.format(tendered ?? total)}</span></div>
          {method.toLocaleLowerCase("es-MX") === "efectivo" ? <div><span>Cambio</span><span>{number.format(change)}</span></div> : null}
        </section>
      ) : null}

      <footer className="thermal-footer">
        {mode === "sale" ? <div className="receipt-barcode" aria-hidden="true" /> : <div className="receipt-qr" aria-hidden="true" />}
        <code>{receiptFolio}</code>
        {mode === "sale" ? <><p>Cambios dentro de 15 días con este ticket<br />y etiqueta original. No aplica en oferta.</p><strong>¡Gracias por su compra!</strong><span>{BUSINESS_PROFILE.website}</span></> : <><p>Presenta este ticket para cambio de talla o modelo dentro de 15 días. No incluye importes ni forma de pago. Sujeto a existencia en la sucursal.</p><strong>{BUSINESS_PROFILE.name.toLocaleUpperCase("es-MX")} · {receiptLocation.name.toLocaleUpperCase("es-MX")}</strong></>}
      </footer>
    </article>
  );
}
