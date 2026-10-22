import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import { physicalComparison, type LegacyPilotView } from "@/lib/legacy-pilot";
import { saveLegacyPilotDraft } from "./actions";
import styles from "../migracion-sicar/review.module.css";
export const metadata: Metadata = {
  title: "Clientes heredados e inventario piloto",
};
const money = (v: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    v / 100,
  );
const notices: Record<string, string> = {
  guardado: "Borrador guardado. Ningún saldo de inventario fue cargado.",
  revision: "Alguien cambió este borrador. Recarga antes de editar.",
  conflicto: "La solicitud cambió al repetirse. No se duplicó.",
  cantidades:
    "Lo vendido pendiente y lo separado no pueden superar el total físico presente.",
  formato:
    "Usa piezas enteras sin signos ni decimales. Vacío significa pendiente.",
  "base-cambiada":
    "Cambió el catálogo o inventario de destino. Hay que conciliar de nuevo.",
  "sin-permiso": "No tienes permiso para editar esta hoja.",
  error: "No se pudo guardar el borrador. Revisa los datos.",
};
export default async function LegacyCustomers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("customers.manage");
  const params = await searchParams;
  const { data, error } = await supabase.rpc("m9_legacy_pilot", {
    p_action: "LIST",
    p_input: { q: (params.q ?? "").slice(0, 100) },
  });
  if (error) throw Error("No se pudo consultar el registro heredado.");
  const view = data as LegacyPilotView;
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Sólo Preview</p>
        <h1>Clientes heredados e inventario piloto</h1>
        <Link href="/migracion" className="button primary">
          Ver migración completa y padrón general
        </Link>
        <p>
          Registro conservado desde SICAR, separado de socios y del portal. No
          concede crédito nuevo; la apertura de ensayo se consulta por separado.
        </p>
        <Link
          href="/clientes/migracion-sicar/conciliacion"
          className="button secondary"
        >
          Ver conciliación de saldos y entregas
        </Link>
        <Link
          href="/clientes/heredados-sicar/saldos"
          className="button primary"
        >
          Ver apertura y ensayar abonos
        </Link>
        <a href="#piloto" className="button primary">
          Capturar inventario piloto
        </a>
      </header>
      <div className={styles.summary}>
        <section>
          <strong>{view.registered}</strong>
          <span>Registros heredados con ID propio</span>
        </section>
        <section>
          <strong>{view.stock.length}</strong>
          <span>Códigos del piloto</span>
        </section>
        <section>
          <strong>
            {view.stock.filter((s) => s.physical_qty === null).length}
          </strong>
          <span>Conteos físicos por capturar</span>
        </section>
        <section>
          <strong>Sin cobro real</strong>
          <span>Inventario y portal sin activar</span>
        </section>
      </div>
      <section
        className={styles.panel}
        aria-label="Registro de clientes heredados"
      >
        <h2>Buscar una cuenta heredada</h2>
        <p>
          Alcance: 61 cuentas de APARTADO. Los nombres repetidos conservan
          referencias distintas; faltar teléfono no elimina la cuenta.
        </p>
        <form className={styles.search}>
          <label>
            Nombre, teléfono o ID interno
            <input name="q" maxLength={100} defaultValue={params.q ?? ""} />
          </label>
          <button className="button primary" type="submit">
            Buscar heredados
          </button>
          <Link href="/clientes/heredados-sicar" className="button secondary">
            Limpiar
          </Link>
        </form>
        <p>{view.customers.length} registros encontrados.</p>
        <div className={styles.accounts}>
          {view.customers.map((c) => (
            <article key={c.id}>
              <div>
                <h3>{c.name}</h3>
                <p>{c.phone ?? "Teléfono sin registrar"}</p>
                <small>
                  Referencia heredada: <code>{c.id}</code>
                </small>
                <p>
                  Saldo del corte de origen: {money(c.source_balance_cents)} ·
                  Consulta la apertura de staging por separado
                </p>
                {!c.source_unchanged ? (
                  <p className={styles.notice}>
                    Origen cambiado: requiere conciliar.
                  </p>
                ) : null}
              </div>
              <Link
                href={`/clientes/migracion-sicar?key=${c.key}`}
                className="button secondary"
              >
                Consultar documentos SICAR
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section
        id="piloto"
        className={styles.panel}
        aria-label="Hoja del inventario piloto"
      >
        <h2>Inventario piloto · La Piedad</h2>
        <p>
          Captura lo que realmente se cuente en tienda. No copies la referencia
          SICAR como conteo físico. Vacío queda pendiente; cero se escribe
          expresamente.
        </p>
        <p>
          Guardar conserva un borrador sin certificar. No reserva, entrega ni
          descuenta mercancía. Los responsables y la evidencia del conteo
          definitivo se validarán antes de importar.
        </p>
        {params.status && notices[params.status] ? (
          <p role="status" className={styles.notice}>
            {notices[params.status]}
          </p>
        ) : null}
        {view.stock.map((s) => {
          const comparison = physicalComparison(
            s.physical_qty,
            s.sold_waiting_qty,
            s.separated_qty,
          );
          return (
            <article key={s.barcode} className={styles.document}>
              <h3>
                <code>{s.barcode}</code> · {s.name}
              </h3>
              <p>
                Referencia SICAR: {s.observed_qty} pieza(s), observada{" "}
                {new Date(s.observed_at).toLocaleString("es-MX", {
                  timeZone: "America/Mexico_City",
                })}
                . Revisión {s.revision}.
              </p>
              {!s.catalog_current || !s.balance_current ? (
                <p className={styles.notice}>
                  Cambió el catálogo o saldo de destino: edición bloqueada hasta
                  conciliar.
                </p>
              ) : null}
              <form action={saveLegacyPilotDraft} className={styles.form}>
                <input type="hidden" name="barcode" value={s.barcode} />
                <input type="hidden" name="revision" value={s.revision} />
                <input
                  type="hidden"
                  name="request"
                  value={crypto.randomUUID()}
                />
                <label>
                  Total físico presente
                  <input
                    name="physical_qty"
                    inputMode="numeric"
                    pattern="(0|[1-9][0-9]{0,5})"
                    placeholder="Pendiente"
                    defaultValue={s.physical_qty ?? ""}
                  />
                </label>
                <label>
                  Ya vendido y guardado para entregar
                  <input
                    name="sold_waiting_qty"
                    inputMode="numeric"
                    pattern="(0|[1-9][0-9]{0,5})"
                    placeholder="Pendiente"
                    defaultValue={s.sold_waiting_qty ?? ""}
                  />
                </label>
                <label>
                  Separado sin venta registrada
                  <input
                    name="separated_qty"
                    inputMode="numeric"
                    pattern="(0|[1-9][0-9]{0,5})"
                    placeholder="Pendiente"
                    defaultValue={s.separated_qty ?? ""}
                  />
                </label>
                <label>
                  Nota del borrador
                  <textarea
                    name="note"
                    minLength={5}
                    maxLength={500}
                    required
                    defaultValue={s.note}
                  />
                </label>
                <p>
                  {comparison.available === null
                    ? "Comparación física pendiente."
                    : `Disponibilidad física comparativa: ${comparison.available} pieza(s). Requiere revisión; no es saldo autorizado.`}
                </p>
                <button
                  type="submit"
                  className="button primary"
                  disabled={!s.catalog_current || !s.balance_current}
                >
                  Guardar borrador sin cargar inventario
                </button>
              </form>
            </article>
          );
        })}
      </section>
    </div>
  );
}
