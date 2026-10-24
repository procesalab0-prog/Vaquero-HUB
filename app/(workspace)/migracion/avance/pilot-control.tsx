import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import { pilotOperationalControl } from "@/lib/m9-pilot-operational-control";
import styles from "../migration.module.css";

const date = (value: string) =>
  new Date(value).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

export default async function PilotControl({
  overview,
}: {
  overview: unknown;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  let result: ReturnType<typeof pilotOperationalControl>;
  try {
    await requirePermission("customers.manage");
    const { supabase } = await requirePermission("inventory.count");
    const reads = await Promise.all([
      supabase.rpc("m9_legacy_registry_read", { p_input: { q: "", page: 1 } }),
      supabase.rpc("m9_delivery_capture_read", {
        p_input: { q: "", filter: "all", page: 1, review_filter: "all" },
      }),
      supabase.rpc("m9_legacy_finance", { p_action: "LIST" }),
    ]);
    if (reads.some((r) => r.error)) throw Error("PILOT_CONTROL_READER_FAILED");
    result = pilotOperationalControl({
      overview,
      registry: reads[0].data,
      delivery: reads[1].data,
      finance: reads[2].data,
      assessedAt: new Date().toISOString(),
    });
  } catch {
    return (
      <section
        className={styles.notice}
        id="control-piloto"
        aria-label="Control del piloto no comprobable"
      >
        <h2>No se pudo comprobar el control del piloto</h2>
        <p>
          Falta permiso, un lector o evidencia coherente. No significa cero
          pendientes ni cambia las retenciones. Recarga o consulta las hojas de
          origen.
        </p>
        <Link href="/migracion/avance">Cerrar control</Link>
      </section>
    );
  }
  const v = result;
  return (
    <section
      className={styles.panel}
      id="control-piloto"
      aria-label="Control único de preparación del piloto"
    >
      <h2>Control del piloto · Cuatro pasos separados</h2>
      <p>
        Lectura de staging del {date(v.assessed_at)}. Las consultas se
        observaron por separado; no son un cierre simultáneo. Este control no
        guarda respuestas ni habilita el arranque.
      </p>
      <ol>
        <li>
          <h3>Contar las doce referencias en tienda</h3>
          <p>
            {v.inventory.declared_current} de 36 datos con declaración vigente
            para su referencia; {v.inventory.unknown} desconocidos,{" "}
            {v.inventory.unattributed} sin atribución y {v.inventory.held}{" "}
            retenidos. {v.inventory.complete_codes} de 12 códigos tienen los
            tres datos declarados.
          </p>
          <p>
            Físico presente incluye mercancía guardada. Vendido y guardado y
            separado sin venta son conjuntos distintos: una pieza no va en
            ambos. Un cero también requiere revisión expresa.{" "}
            {v.inventory.review_inputs_complete
              ? "Las declaraciones están completas para revisar; todavía no certifican el físico ni permiten importarlo."
              : "Faltan declaraciones válidas para completar la revisión física."}
          </p>
          <p>
            Doce referencias SICAR de la hoja, intervalo original:{" "}
            {`${date(v.inventory.source_dates[0])} a ${date(v.inventory.source_dates[v.inventory.source_dates.length - 1])}`}
            . Imprimir o guardar una nota no renueva esa referencia.
          </p>
          <Link
            className="button primary"
            href="/clientes/heredados-sicar#piloto"
          >
            Abrir los doce códigos
          </Link>{" "}
          <Link
            className="button secondary"
            href="/clientes/heredados-sicar/hoja"
          >
            Imprimir hoja vacía
          </Link>
        </li>
        <li>
          <h3>Comprobar compromisos por folio</h3>
          <p>
            Archivo histórico: {v.delivery.documents} folios y{" "}
            {v.delivery.source_lines} líneas.{" "}
            {v.delivery.pending_documentary_reviews} folios por revisar;{" "}
            {v.delivery.concrete_documentary_reviews} con declaración documental
            concreta. Las {v.delivery.source_unknown_lines} líneas de origen
            conservan entrega UNKNOWN.
          </p>
          <p>
            Si hay mercancía guardada o separada, identificar folio y línea y
            comprobar el efecto anterior en inventario. «Todo entregado» es una
            declaración documental: no prueba una observación física ni autoriza
            mover stock. Sin coincidencia en el archivo no significa cero
            compromisos actuales. SX00000 representa deuda genérica, no piezas.
          </p>
          <Link className="button primary" href="/migracion/entregas">
            Revisar ocho folios por tanda
          </Link>
        </li>
        <li>
          <h3>Renovar el corte antes del ensayo de arranque</h3>
          <p>
            Padrón:{" "}
            {v.cuts.census
              ? `${date(v.cuts.census.from)} a ${date(v.cuts.census.until)}${v.cuts.census.older_than_24h ? " · mayor de 24 horas" : " · dentro de 24 horas"}`
              : "sin evidencia"}
            . Detalle: {date(v.cuts.detail.from)} a {date(v.cuts.detail.until)}
            {v.cuts.detail.older_than_24h
              ? " · mayor de 24 horas"
              : " · dentro de 24 horas"}
            .
          </p>
          <p>
            {v.cuts.review_inputs_recent
              ? "Los intervalos están dentro de 24 horas; eso no acredita un corte operativo simultáneo ni su autorización."
              : "Hace falta renovar la evidencia para evaluar el corte operativo."}{" "}
            No reemplazar el corte anterior ni interpretar un saldo distinto
            como abono o entrega.
          </p>
          <Link className="button secondary" href="/migracion">
            Consultar padrón y diferencias
          </Link>{" "}
          <Link className="button secondary" href="/migracion/creditos">
            Consultar detalle y abonos históricos
          </Link>
        </li>
        <li>
          <h3>Apertura financiera: no evaluada por este control</h3>
          <p>
            El libro separado de staging contiene {v.financial.accounts} cuentas
            con {v.financial.documents} documentos de apertura y{" "}
            {v.financial.trial_count} ensayos registrados. No son saldos
            operativos confirmados para el arranque.
          </p>
          <p>
            Se necesita revisar identidad, cuenta completa, saldo y abonos del
            corte, aprobación y ausencia de doble apertura mediante los
            controles existentes. La entrega UNKNOWN se evalúa aparte: no decide
            por sí sola si puede abrirse un saldo puramente financiero. Este
            panel no permite cobrar, reservar ni entregar mercancía.
          </p>
          <Link
            className="button secondary"
            href="/clientes/heredados-sicar/saldos"
          >
            Consultar aperturas y ensayo separado
          </Link>
        </li>
      </ol>
      <p>
        No hay porcentaje global ni autorización operativa. Conteo físico,
        declaración documental y apertura financiera son comprobaciones
        distintas.
      </p>
      <Link href="/migracion/avance">Cerrar control</Link>
    </section>
  );
}
