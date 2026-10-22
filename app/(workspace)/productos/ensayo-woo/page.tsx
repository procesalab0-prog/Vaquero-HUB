import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import { remoteWebConfigured } from "@/lib/remote-web-server";
import {
  enqueueWooTrial,
  runAvailabilityTrial,
  runConnectedWooTrial,
  runInventoryProbe,
} from "./actions";
import styles from "../../clientes/migracion-sicar/review.module.css";
import { ContentionProbe } from "./contention-probe";
export const metadata: Metadata = { title: "Pedido Woo · Ensayo conectado" };
export const dynamic = "force-dynamic";
type Trial = {
  id: string;
  state: string;
  created_at: string;
  availability?: null | {
    state: string;
    receipt?: { quantities: number[]; restored: boolean };
  };
  result: null | {
    order_id: number;
    barcode: string;
    quantity: number;
    native_operations: number;
    idempotent_replays: number;
    remote_status: string;
    availability_capture_rollback?: boolean;
    pos_inventory_operations?: number;
    history: {
      phase: string;
      physical: number;
      reserved: number;
      available: number;
    }[];
  };
};
export default async function ConnectedWooTrialPage({
  searchParams,
}: {
  searchParams: Promise<{
    cola?: string;
    estado?: string;
    estado_disponibilidad?: string;
    concurrencia?: string;
    solicitud?: string;
    familia?: string;
  }>;
}) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL) notFound();
  const { supabase } = await requirePermission("products.update");
  const { data, error } = await supabase.rpc("m9_connected_woo_status");
  if (error) notFound();
  const queue = await supabase.rpc("m9_woo_worker_status");
  const jobs = (queue.data?.jobs ?? []) as {
    id: string;
    state: string;
    phase: string;
    attempts: number;
    last_error: string | null;
  }[];
  const queueOpen = queue.data?.window_open === true;
  const params = await searchParams;
  const families = data.families as { id: string; name: string }[];
  const trials = data.trials as Trial[];
  const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  const id =
    params.solicitud && uuid.test(params.solicitud)
      ? params.solicitud
      : crypto.randomUUID();
  const parent = families.some((f) => f.id === params.familia)
    ? params.familia
    : families[0]?.id;
  const current = trials.find((t) => t.id === id);
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Preview · Sin dinero real</p>
        <h1>Pedido Woo de pruebas</h1>
        <p>
          Comprueba el recorrido entre Woo de pruebas y el inventario del
          programa.
        </p>
        <Link className="button secondary" href="/productos">
          Volver a productos
        </Link>
      </header>
      {params.concurrencia && uuid.test(params.concurrencia) && (
        <ContentionProbe
          trialId={params.concurrencia}
          runProbeAction={runInventoryProbe}
        />
      )}
      <section className={styles.panel} aria-label="Alcance del ensayo">
        <h2>Un pedido sintético, sin cobro ni envío</h2>
        <p>
          Se crea un pedido de dos camisas talla M en Woo de pruebas, se pasa a
          procesamiento y queda cancelado. En el programa se ensayan la reserva,
          el descuento y la reposición.
        </p>
        <p>
          <strong>Las piezas son de prueba.</strong> Todos los cambios de
          inventario del programa se revierten. Sólo quedan el pedido cancelado
          y su comprobante de ensayo.
        </p>
        <p>
          Los pagos, correos y compras públicas siguen bloqueados. Esto no es
          una venta real ni importa existencias de SICAR.
        </p>
      </section>
      {params.estado_disponibilidad && (
        <section className={styles.panel} role="status">
          <h2>
            {params.estado_disponibilidad === "verificado"
              ? "Disponibilidad comprobada en Woo"
              : "La disponibilidad requiere revisión"}
          </h2>
          <p>
            {params.estado_disponibilidad === "verificado"
              ? "Woo recibió las cantidades sintéticas, pasó por agotado y recuperó sus campos de inventario originales."
              : "Retoma el mismo comprobante. No generes otra solicitud para resolver una respuesta incierta."}
          </p>
        </section>
      )}
      {params.estado === "revision" && (
        <section className={styles.panel} role="status">
          <h2>El resultado necesita revisión</h2>
          <p>
            Conserva esta solicitud. Usa «Consultar y retomar» para recuperar el
            mismo ensayo; no crees otro pedido para resolver una respuesta
            perdida.
          </p>
        </section>
      )}
      <section
        className={styles.panel}
        aria-label="Recorrido automático de prueba"
      >
        <h2>Pedido y disponibilidad en un solo recorrido</h2>
        <p>
          Guarda la solicitud una vez. Durante la ventana de ensayo, el
          programador continúa cada fase aunque cierres esta pantalla.
        </p>
        <p>
          {queueOpen
            ? "Ventana de ensayo abierta."
            : "Ventana cerrada: no se envían trabajos."}{" "}
          Un fallo de conexión se retoma con la misma solicitud. Un resultado
          incierto queda en revisión.
        </p>
        {params.cola && (
          <p role="status">
            {params.cola === "guardado"
              ? "Solicitud guardada. Actualiza para consultar su progreso."
              : "No se pudo guardar. Conserva esta solicitud para revisarla."}
          </p>
        )}
        <form action={enqueueWooTrial}>
          <input type="hidden" name="request_id" value={id} />
          <label htmlFor="queue-family">
            Familia para el recorrido completo
          </label>
          <select
            id="queue-family"
            name="parent_id"
            defaultValue={parent}
            required
          >
            {families.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name}
              </option>
            ))}
          </select>
          <button
            className="button"
            disabled={!queueOpen || !remoteWebConfigured() || !families.length}
          >
            Guardar recorrido automático de prueba
          </button>
        </form>
        <Link className="button secondary" href="/productos/ensayo-woo">
          Actualizar progreso
        </Link>
        <ul>
          {jobs.map((job) => (
            <li key={job.id} style={{ overflowWrap: "anywhere" }}>
              {job.id} ·{" "}
              {job.state === "DONE"
                ? "Pedido y disponibilidad comprobados; inventarios restaurados"
                : job.state === "REVIEW"
                  ? "Requiere revisión; envío detenido"
                  : job.state === "RUNNING"
                    ? "Comprobando"
                    : job.state === "RETRY"
                      ? "Esperando reintento de conexión"
                      : "En espera"}
              {job.state !== "DONE" && (
                <> · {job.phase === "ORDER" ? "Pedido" : "Disponibilidad"}</>
              )}
              {job.last_error && <> · {job.last_error}</>}
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.panel}>
        <h2>
          {current?.state === "VERIFIED"
            ? "Ensayo confirmado"
            : "Preparar recorrido"}
        </h2>
        <form action={runConnectedWooTrial}>
          <input type="hidden" name="request_id" value={id} />
          <label htmlFor="woo-trial-family">Familia de prueba</label>
          <select
            id="woo-trial-family"
            name="parent_id"
            defaultValue={parent}
            required
          >
            {families.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name}
              </option>
            ))}
          </select>
          <p>
            Se conserva el código de barras de la talla M y su precio público.
          </p>
          <button
            className="button"
            disabled={!remoteWebConfigured() || !families.length}
          >
            {current
              ? "Consultar y retomar el mismo ensayo"
              : "Ensayar pedido en Woo de pruebas"}
          </button>
        </form>
        <p>
          Máximo cinco solicitudes nuevas al día. Repetir la misma conserva el
          pedido.
        </p>
        {current?.state === "VERIFIED" && (
          <Link className="button secondary" href="/productos/ensayo-woo">
            Preparar otro ensayo
          </Link>
        )}
      </section>
      <section
        className={styles.panel}
        aria-label="Resultados de pedidos de prueba"
      >
        <h2>Comprobantes de ensayo</h2>
        {!trials.length && (
          <p>Todavía no hay ensayos conectados de tu usuario.</p>
        )}
        {trials.map((trial) => (
          <article key={trial.id}>
            <h3>
              {trial.state === "VERIFIED"
                ? `Pedido Woo ${trial.result?.order_id} · Cancelado`
                : "Solicitud en comprobación"}
            </h3>
            <p>
              Solicitud:{" "}
              <span style={{ overflowWrap: "anywhere" }}>{trial.id}</span>
            </p>
            {trial.result && (
              <>
                <p>
                  Código {trial.result.barcode} · {trial.result.quantity} piezas
                  sintéticas · talla M.
                </p>
                {trial.result.availability_capture_rollback && (
                  <div>
                    <p>
                      Captura atómica de reservas y{" "}
                      {trial.result.pos_inventory_operations} movimientos
                      sintéticos del inventario de caja, con rollback.
                    </p>
                    <form action={runAvailabilityTrial}>
                      <input type="hidden" name="request_id" value={trial.id} />
                      <button
                        className="button secondary"
                        disabled={!remoteWebConfigured()}
                      >
                        {trial.availability
                          ? "Consultar el mismo ensayo de disponibilidad"
                          : "Ensayar disponibilidad en Woo"}
                      </button>
                    </form>
                    {trial.availability?.state === "VERIFIED" && (
                      <p>
                        Comprobado:{" "}
                        {trial.availability.receipt?.quantities.join(" → ")}{" "}
                        piezas de prueba. Stock original de Woo restaurado.
                      </p>
                    )}
                    {trial.availability?.state === "DISPATCHING" && (
                      <p>
                        Resultado pendiente. Consulta este mismo ensayo; no
                        crees otro.
                      </p>
                    )}
                  </div>
                )}
                <ul>
                  {trial.result.history.map((row) => (
                    <li key={row.phase}>
                      {row.phase === "RESERVE"
                        ? "Reservar"
                        : row.phase === "CONSUME"
                          ? "Descontar"
                          : "Reponer"}
                      : {row.physical} físicas · {row.reserved} reservadas ·{" "}
                      {row.available} disponibles durante la prueba.
                    </li>
                  ))}
                </ul>
                <p>
                  {trial.result.idempotent_replays} repeticiones verificadas sin
                  duplicar. Inventario del programa restaurado al finalizar.
                </p>
              </>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
