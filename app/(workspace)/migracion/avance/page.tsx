import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import styles from "../migration.module.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Avance de migración · Frentes y pendientes" };
type Overview = {
  assembled_at: string;
  catalog: {
    loaded_codes: number;
    review_rows_on_file: number;
    review_window: { window_current: boolean; expires_at: string | null };
    photo_evidence_rows: number;
    photo_storage_rows: number;
  };
  customers: {
    census_available: boolean;
    census_from: string | null;
    census_until: string | null;
    census_older_than_24h: boolean | null;
    details_available: boolean;
    details_from: string | null;
    details_until: string | null;
    accounts_reviewed: number | null;
    documents_reviewed: number | null;
    historical_payments: number | null;
    mapped_lines: number | null;
    unmapped_lines: number | null;
    unconfirmed_deliveries: number | null;
    registered_legacy_accounts: number;
  };
  inventory: { codes: number; pending_fields: number };
  woo: {
    remote_connected_trials: number;
    native_rehearsals: number;
    finance_enabled: boolean;
    stock_pilot_enabled: boolean;
    worker_enabled: boolean;
    capture_enabled: boolean;
  };
};
const n = (value: number | null) =>
  value === null ? "Sin evidencia" : value.toLocaleString("es-MX");
const date = (value: string | null) =>
  value === null
    ? "Sin captura"
    : new Date(value).toLocaleString("es-MX", {
        timeZone: "America/Mexico_City",
      });
export default async function MigrationProgress() {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("customers.manage");
  const { data, error } = await supabase.rpc("m9_parallel_readonly_overview");
  if (error?.code === "42501") notFound();
  if (
    error ||
    data?.protocol !== "m9-parallel-overview-1" ||
    data?.operational_authorization !== false
  )
    throw Error("No se pudo comprobar el resumen de migración.");
  const v = data as Overview;
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Sólo pruebas · Consulta sin cambios</p>
        <h1>Avance por frentes</h1>
        <p>
          Lo preparado, lo retenido y el siguiente paso de cada parte de la
          migración.
        </p>
        <Link className="button secondary" href="/migracion">
          Volver al centro de migración
        </Link>
      </header>
      <section className={styles.notice}>
        <h2>Esta pantalla no habilita el arranque</h2>
        <p>
          Consulta de staging del {date(v.assembled_at)}. No importa productos,
          fotos, existencias, saldos ni pagos. Un dato pendiente se conserva sin
          definir; no se convierte en cero.
        </p>
        <p>
          Las cifras de catálogo, archivos históricos y ensayos miden cosas
          distintas. No se suman para inventar un porcentaje global.
        </p>
      </section>
      <div className={styles.cards}>
        <section>
          <strong>{n(v.catalog.loaded_codes)}</strong>
          <h2>Códigos SICAR conservados</h2>
          <p>
            {n(v.catalog.review_rows_on_file)} revisiones guardadas. La ventana
            de revisión para nuevas ventas de ensayo está{" "}
            {v.catalog.review_window.window_current
              ? "vigente"
              : "sin vigencia"}
            ; el listado por sí solo no autoriza vender.
          </p>
          <p>
            {n(v.catalog.photo_evidence_rows)} evidencias de fotos y{" "}
            {n(v.catalog.photo_storage_rows)} vínculos de copia conservados. Una
            ausencia deliberada o una foto propia no se rellena automáticamente.
          </p>
          <p>
            <b>Siguiente:</b> comprobar identidad, fuente vigente y fotos
            propias antes de preparar cada lote de adopción.
          </p>
          <Link
            className="button primary"
            href="/inventario?ubicacion=467765fe-d18e-43bb-be68-326adbf05ce1"
          >
            Consultar catálogo completo
          </Link>
          <Link href="/productos/migracion-pendientes">
            Revisar casos retenidos
          </Link>
        </section>
        <section>
          <strong>{n(v.customers.documents_reviewed)}</strong>
          <h2>Documentos de clientes revisados</h2>
          <p>
            {n(v.customers.accounts_reviewed)} cuentas y{" "}
            {n(v.customers.historical_payments)} abonos históricos en la
            revisión documental.
          </p>
          <p>
            {n(v.customers.unmapped_lines)} líneas sin variante identificada en
            Mi Tienda; {n(v.customers.unconfirmed_deliveries)} entregas sin
            acreditar. Tener un saldo no demuestra que falte entregar el
            producto.
          </p>
          <p>
            <b>Siguiente:</b> comparar el corte nuevo por cuenta y documento
            completo, conservar abonos cancelados y evitar abrir dos veces la
            misma deuda.
          </p>
          <Link className="button primary" href="/migracion/creditos">
            Revisar créditos y abonos
          </Link>
          <Link href="/clientes/heredados-sicar/saldos">
            Consultar apertura de ensayo
          </Link>
        </section>
        <section>
          <strong>{n(v.inventory.pending_fields)}</strong>
          <h2>Datos físicos pendientes del piloto</h2>
          <p>
            Hoja de {n(v.inventory.codes)} códigos: físico presente, vendido que
            sigue guardado y mercancía separada.
          </p>
          <p>
            <b>Siguiente:</b> completar conteos y entregas con evidencia,
            conciliar lo observado en SICAR y ensayar sólo el lote confirmado.
            La exportación no sustituye el conteo físico.
          </p>
          <Link
            className="button primary"
            href="/clientes/heredados-sicar#piloto"
          >
            Abrir hoja de conteo del piloto
          </Link>
          <Link href="/clientes/migracion-sicar/conciliacion">
            Consultar entregas pendientes
          </Link>
        </section>
        <section>
          <strong>{n(v.woo.remote_connected_trials)}</strong>
          <h2>Ensayos conectados con Woo de pruebas</h2>
          <p>
            {n(v.woo.native_rehearsals)} recibo(s) del ciclo nativo con
            reversión. La última pieza pasó ocho escenarios simultáneos SQL
            locales; esto no acredita una pasarela ni una compra completa desde
            Woo.
          </p>
          <p>
            Controles actuales: trabajador{" "}
            {v.woo.worker_enabled ? "habilitado" : "apagado"}, captura de
            disponibilidad {v.woo.capture_enabled ? "habilitada" : "apagada"},
            piloto de stock{" "}
            {v.woo.stock_pilot_enabled ? "habilitado" : "apagado"} y ensayo
            financiero {v.woo.finance_enabled ? "habilitado" : "apagado"}.
            Habilitado tampoco significa pago verificado.
          </p>
          <p>
            <b>Siguiente:</b> verificar el pago con evidencia independiente de
            la pasarela de pruebas y comprobar el pedido completo, sus importes
            y su inventario.
          </p>
          <Link className="button primary" href="/productos/ensayo-woo/venta">
            Ver pruebas de venta y reversión
          </Link>
        </section>
      </div>
      <section className={styles.panel}>
        <h2>Fechas que se conservan</h2>
        <p>
          Padrón general: {date(v.customers.census_from)} a{" "}
          {date(v.customers.census_until)}.{" "}
          {v.customers.census_older_than_24h === true
            ? "Ya superó las 24 horas; debe renovarse antes de operar."
            : v.customers.census_available
              ? "Es una captura por intervalo, no un cierre simultáneo."
              : "No hay padrón archivado para comprobar."}
        </p>
        <p>
          Detalle de créditos: {date(v.customers.details_from)} a{" "}
          {date(v.customers.details_until)}.{" "}
          {v.customers.details_available
            ? "Su archivo histórico se conserva separado del padrón y de las aperturas."
            : "No hay detalle archivado para comprobar."}
        </p>
        <p>
          La tienda continúa operando en SICAR. Antes del arranque se renovarán
          los cortes de SICAR y Woo, se revisarán sus diferencias y se cargará
          por etapas lo confirmado. Los casos dudosos permanecen retenidos.
        </p>
        <Link className="button secondary" href="/migracion#cuentas">
          Consultar el padrón histórico
        </Link>
      </section>
    </div>
  );
}
