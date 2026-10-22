import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import { rehearseNativeWooSale } from "./actions";
import styles from "../../../migracion/migration.module.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Venta Woo · Ensayo nativo con reversión" };
type Proof = {
  all_synthetic_operations_rolled_back: boolean;
  native_sale_verified: boolean;
  native_payment_verified: boolean;
  native_ticket_verified: boolean;
  post_replay_verified: boolean;
  cancel_replay_verified: boolean;
  unknown_cost_preserved: boolean;
  physical_cash_movements: number;
  deduction_movements: number;
  restoration_movements: number;
  operational_sale_persisted: boolean;
  quantities: { seed: string; after_sale: string; after_full_cancel: string };
};
type Run = { id: string; created_at: string; result: Proof };
type Context = {
  sessions: Array<{ id: string; location: string; register: string }>;
  runs: Run[];
};
const fecha = (v: string) =>
  new Date(v).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
export default async function NativeWooRehearsal({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; ensayo?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL) notFound();
  const { supabase } = await requirePermission("pos.sell");
  const { data, error } = await supabase.rpc("m9_woo_native_rehearsal_context");
  if (error) notFound();
  const context = data as Context,
    params = await searchParams;
  const selected =
    context.runs.find((r) => r.id === params.ensayo) ?? context.runs[0];
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Sólo staging · ADMIN</p>
        <h1>Ensayo de venta Woo en Mi Tienda</h1>
        <p>
          Comprobar reserva, venta nativa, pago, ticket y cancelación dentro de
          una prueba que se revierte al terminar.
        </p>
        <Link className="button secondary" href="/productos/ensayo-woo">
          Volver a los ensayos Woo
        </Link>
      </header>
      <section className={styles.notice}>
        <h2>Sin compra ni cobro real</h2>
        <p>
          Se usan cantidades y pagos sintéticos, identificados como prueba. No
          se crea ningún pedido en Woo ni se ejecuta una pasarela.
        </p>
        <p>
          El ciclo prueba venta y cancelación total con recepción física
          simulada. Después retira todos sus efectos mediante rollback. Sólo
          queda el recibo del ensayo; no queda una venta operativa ni un ticket
          para cobrar.
        </p>
      </section>
      <section className={styles.panel}>
        <h2>Ejecutar y comprobar la reversión</h2>
        <p>
          Usa una sesión de caja propia de este Preview. El ensayo no mueve
          efectivo, no utiliza existencias SICAR y conserva en blanco los costos
          desconocidos.
        </p>
        <form action={rehearseNativeWooSale} className={styles.filters}>
          <input type="hidden" name="operation_id" value={randomUUID()} />
          <label>
            Sesión de prueba
            <select
              name="session_id"
              required
              disabled={!context.sessions.length}
            >
              {context.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.location} · {s.register}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary"
            disabled={!context.sessions.length}
          >
            Ejecutar ensayo y revertirlo
          </button>
        </form>
        {!context.sessions.length && (
          <p>
            Necesitas una sesión propia abierta en La Piedad dentro de este
            Preview. No abras una caja de producción para esta prueba.
          </p>
        )}
        {params.estado === "revision" && (
          <p role="status">
            No se completó la comprobación. No se habilitó la operación real; el
            entorno puede haber cambiado o requerir revisión.
          </p>
        )}
        {params.estado === "espera" && (
          <p role="status">
            Espera 30 segundos entre ensayos nuevos. Repetir la misma solicitud
            conserva su recibo.
          </p>
        )}
        {params.estado === "verificado" && selected && (
          <p role="status">
            Ensayo verificado: venta y cancelación probadas; todos sus efectos
            sintéticos fueron revertidos.
          </p>
        )}
      </section>
      {selected && (
        <section className={styles.panel} aria-label="Resultado del ensayo">
          <h2>Resultado conservado · {fecha(selected.created_at)}</h2>
          <ul>
            <li>
              Venta nativa:{" "}
              {selected.result.native_sale_verified
                ? "verificada"
                : "sin verificar"}
              . Pago de ensayo separado del efectivo.
            </li>
            <li>
              Ticket nativo:{" "}
              {selected.result.native_ticket_verified
                ? "leído dentro del ensayo"
                : "sin verificar"}
              ; no existe como venta operativa después de revertir.
            </li>
            <li>
              Descuento de mercancía: {selected.result.deduction_movements}{" "}
              movimientos, uno por línea; sin doble descuento.
            </li>
            <li>
              Cancelación total con recepción simulada:{" "}
              {selected.result.restoration_movements} movimientos de reposición,
              uno por línea.
            </li>
            <li>
              Reintentos de venta y cancelación:{" "}
              {selected.result.post_replay_verified &&
              selected.result.cancel_replay_verified
                ? "sin duplicar efectos"
                : "sin verificar"}
              .
            </li>
            <li>
              Movimientos de efectivo: {selected.result.physical_cash_movements}
              . Costo desconocido:{" "}
              {selected.result.unknown_cost_preserved
                ? "conservado en blanco"
                : "sin verificar"}
              .
            </li>
            <li>
              Estado final:{" "}
              {selected.result.all_synthetic_operations_rolled_back
                ? "todos los efectos del ensayo revertidos"
                : "requiere revisión"}
              .
            </li>
          </ul>
          <p>
            Secuencia de cantidades ficticias para los dos artículos:{" "}
            {selected.result.quantities.seed} →{" "}
            {selected.result.quantities.after_sale} →{" "}
            {selected.result.quantities.after_full_cancel}. Al terminar el
            rollback regresan al estado previo al ensayo.
          </p>
          <p>
            Referencia del ensayo: <code>{selected.id}</code>. Es un recibo de
            verificación, no un folio de venta.
          </p>
        </section>
      )}
      <section
        className={styles.panel}
        aria-label="Pruebas simultáneas del motor"
      >
        <p className="eyebrow">
          Verificado el 22 de octubre · SQL local aislado
        </p>
        <h2>Última pieza: 8 escenarios simultáneos aprobados</h2>
        <p>
          Dos procesos distintos compitieron por existencias ficticias. Se
          observó el bloqueo antes de confirmar cada operación: la última pieza
          no se vendió dos veces.
        </p>
        <ul>
          <li>Reserva Woo primero: POS rechaza la segunda salida.</li>
          <li>Venta POS primero: Woo rechaza la reserva sin existencias.</li>
          <li>Venta nativa Woo contra POS: un solo descuento.</li>
          <li>Dos pagos iguales: una sola venta y el mismo recibo.</li>
          <li>Dos cancelaciones iguales: una sola reposición.</li>
          <li>POS se revierte: Woo puede reservar la pieza.</li>
          <li>Woo se revierte: POS puede vender la pieza.</li>
          <li>Dos artículos en orden opuesto: sin bloqueo circular.</li>
        </ul>
        <p>
          Se reconstruyeron las 196 migraciones y coincidieron las huellas de
          las cinco funciones críticas con staging. Esto verifica el motor SQL
          con datos sintéticos; la compra completa desde Woo, su pasarela y la
          red todavía requieren su propia aceptación. Estas pruebas no habilitan
          cobros ni existencias operativas.
        </p>
      </section>
      <section className={styles.panel}>
        <h2>Lo que sigue separado</h2>
        <p>
          La pasarela de pruebas, descuentos, impuestos, envío, devoluciones
          parciales y aceptación de compra completa desde Woo requieren sus
          propias comprobaciones. Ningún estado Woo por sí solo acredita pago ni
          reposición física.
        </p>
        <Link className="button secondary" href="/migracion">
          Ver preparación de la migración
        </Link>
      </section>
    </div>
  );
}
