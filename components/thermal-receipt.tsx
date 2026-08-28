import Image from "next/image";

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
};

const number = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatReceiptDate(date = new Date()) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(",", "");
}

function saleFolioToGift(folio: string) {
  return `R-${folio.replace(/^V-/, "")}-1`;
}

export function ThermalReceipt({ mode, folio, date, items, subtotal = 0, discount = 0, total = 0, method = "Efectivo", tendered, change = 0, reprintLabel }: ThermalReceiptProps) {
  const receiptFolio = mode === "gift" ? saleFolioToGift(folio) : folio;
  return (
    <article className={`thermal-receipt print-receipt ${mode === "gift" ? "gift-receipt" : "sale-receipt"}`} aria-label={mode === "gift" ? "Vista previa del ticket de regalo" : "Vista previa del ticket de venta"}>
      <header className="receipt-brand">
        <Image src="/brand/logo-vaquerosm-negro.png" alt="Vaquero SM" width={300} height={200} priority />
        {mode === "sale" ? <p>VAQUERO SM · SUCURSAL LA PIEDAD<br />Av. Lázaro Cárdenas 480, Centro<br />La Piedad, Michoacán · Tel. 352 145 6880</p> : null}
      </header>

      {mode === "gift" ? <div className="gift-receipt-title">TICKET DE REGALO</div> : null}

      <section className="receipt-meta">
        <div><span>Folio</span><code>{receiptFolio}</code></div>
        <div><span>Fecha</span><span>{date}</span></div>
        {mode === "sale" ? <><div><span>Cajero</span><span>Salomon</span></div><div><span>Caja</span><span>Caja 01</span></div></> : <div><span>Sucursal</span><span>La Piedad</span></div>}
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
        {mode === "sale" ? <><p>Cambios dentro de 15 días con este ticket<br />y etiqueta original. No aplica en oferta.</p><strong>¡Gracias por su compra!</strong><span>vaquerosm.com</span></> : <><p>Presenta este ticket para cambio de talla o modelo dentro de 15 días. No incluye importes ni forma de pago. Sujeto a existencia en la sucursal.</p><strong>VAQUERO SM · LA PIEDAD</strong></>}
      </footer>
    </article>
  );
}
