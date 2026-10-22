import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import { remoteWebConfigured } from "@/lib/remote-web-server";
import { reviewWooFinance } from "./actions";
import styles from "../../../clientes/migracion-sicar/review.module.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Pedido Woo · Revisión de importes" };
const pesos = (c: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    c / 100,
  );
type Observation = {
  id: string;
  observed_at: string;
  review: {
    classification: string;
    observed_total_cents: number;
    payment_date_observed: string | null;
    paid_amount_cents: null;
    can_record_sale: false;
    can_issue_sale_ticket: false;
    catalog: { name: string; barcode: string; cost_cents: number | null };
  };
};
export default async function WooFinanceReview({
  searchParams,
}: {
  searchParams: Promise<{ solicitud?: string; estado?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL) notFound();
  const params = await searchParams;
  if (
    !params.solicitud ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(params.solicitud)
  )
    notFound();
  const { supabase } = await requirePermission("products.update");
  const { data, error } = await supabase.rpc("m9_woo_finance_context", {
    p_trial: params.solicitud,
  });
  if (error) notFound();
  const reads = data.reads as Observation[];
  const current = reads[0];
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Preview · Sólo lectura</p>
        <h1>Revisar pedido Woo {data.reference.order_id}</h1>
        <p>
          Comprobamos las líneas y los importes antes de unir el pedido con una
          venta.
        </p>
        <Link className="button secondary" href="/productos/ensayo-woo">
          Volver a ensayos
        </Link>
      </header>
      <section className={styles.panel} aria-label="Alcance de la revisión">
        <h2>Pedido de prueba cancelado</h2>
        <p>
          Esta revisión no es un ticket de venta. No registra pagos, salidas de
          caja ni movimientos de inventario.
        </p>
        <form action={reviewWooFinance}>
          <input type="hidden" name="request_id" value={params.solicitud} />
          <button className="button" disabled={!remoteWebConfigured()}>
            {current
              ? "Volver a comprobar el mismo pedido"
              : "Leer importes y pago desde Woo de pruebas"}
          </button>
        </form>
        {params.estado === "revision" && (
          <p role="status">
            No se pudo comprobar la lectura. Se conserva la evidencia anterior;
            no se contabiliza el pedido.
          </p>
        )}
      </section>
      {current ? (
        <section className={styles.panel} aria-label="Importes comprobados">
          <h2>
            {current.review.classification === "CANCELLED_PAYMENT_DATE_REVIEW"
              ? "Fecha de pago pendiente de conciliación"
              : "Pedido cancelado sin pago confirmado"}
          </h2>
          <p>
            {current.review.classification === "CANCELLED_PAYMENT_DATE_REVIEW"
              ? "Woo tiene una fecha de pago, pero este ensayo no ejecutó un pago y no tiene referencia de transacción. La fecha por sí sola no confirma un cobro."
              : "No existe un pago confirmado para generar una venta."}
          </p>
          <p>
            <strong>No se genera venta ni ticket de venta.</strong>
          </p>
          <h3>{current.review.catalog.name}</h3>
          <p>
            Código de barras: <strong>{current.review.catalog.barcode}</strong>{" "}
            · {data.reference.quantity} piezas del pedido de prueba.
          </p>
          <dl>
            <dt>Precio unitario comprobado</dt>
            <dd>{pesos(data.reference.unit_price_cents)}</dd>
            <dt>Total observado en Woo</dt>
            <dd>{pesos(current.review.observed_total_cents)}</dd>
            <dt>Pago conciliado</dt>
            <dd>Sin confirmar</dd>
            <dt>Costo unitario del catálogo</dt>
            <dd>
              {current.review.catalog.cost_cents === null
                ? "Sin definir"
                : pesos(current.review.catalog.cost_cents)}
            </dd>
          </dl>
          <p>
            No se calcula utilidad con un costo sin definir. Los descuentos,
            envío e impuestos del pedido fueron comprobados por separado.
          </p>
          <p>
            Comprobación guardada. Repetir una lectura idéntica conserva el
            misma observación.
          </p>
        </section>
      ) : (
        <section className={styles.panel}>
          <h2>Listo para consultar Woo</h2>
          <p>
            La consulta comprueba dos lecturas iguales y conserva una
            observación del pedido. No modifica Woo.
          </p>
        </section>
      )}
    </div>
  );
}
