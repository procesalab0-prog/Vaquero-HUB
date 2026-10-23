import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import { physicalComparison, type LegacyPilotView } from "@/lib/legacy-pilot";
import { saveLegacyPilotDraft } from "./actions";
import {
  PILOT_COUNT_FIELDS,
  pilotEvidenceComplete,
} from "@/lib/legacy-pilot-declarations";
import styles from "../migracion-sicar/review.module.css";
import pilotStyles from "./pilot.module.css";
export const metadata: Metadata = {
  title: "Clientes heredados e inventario piloto",
};
const money = (v: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    v / 100,
  );
const notices: Record<string, string> = {
  ocupado:
    "Otro proceso está usando el catálogo o inventario. No se guardó este intento; recarga y vuelve a intentarlo.",
  "recibo-historico":
    "Esta solicitud ya tenía un recibo histórico. No se volvió a guardar; revisa el borrador actual.",
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
  evidencia:
    "Para declarar una cantidad, marca que revisaste ese dato ahora y explica cómo lo comprobaste. Vacío queda pendiente.",
};
export default async function LegacyCustomers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("customers.manage");
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 100);
  const page = /^[1-9][0-9]{0,5}$/.test(params.page ?? "")
    ? Number(params.page)
    : 1;
  const { data, error } = await supabase.rpc("m9_legacy_registry_read", {
    p_input: { q, page },
  });
  if (error?.code === "42501") notFound();
  if (
    error ||
    data?.protocol !== "m9-legacy-registry-page-1" ||
    data?.read_only !== true
  )
    throw Error("No se pudo consultar el registro heredado.");
  const view = data as LegacyPilotView;
  const pageLink = (n: number) =>
    "/clientes/heredados-sicar?" +
    new URLSearchParams({ q, page: String(n) }).toString() +
    "#registro";
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
        id="registro"
        className={styles.panel}
        aria-label="Registro de clientes heredados"
      >
        <h2>Buscar una cuenta heredada</h2>
        <p>
          Incluye el primer paquete de APARTADO y {view.general_archived}{" "}
          cuentas adicionales del archivo general. Registrar el origen no abre
          una deuda ni habilita cobros. Los nombres repetidos conservan
          referencias distintas; faltar teléfono no elimina la cuenta.
        </p>
        <form className={styles.search}>
          <label>
            Nombre, teléfono, referencia SICAR o ID interno
            <input name="q" maxLength={100} defaultValue={q} />
          </label>
          <button className="button primary" type="submit">
            Buscar heredados
          </button>
          <Link href="/clientes/heredados-sicar" className="button secondary">
            Limpiar
          </Link>
        </form>
        <p>
          {view.total} registros encontrados · Página {view.page} de{" "}
          {view.pages}.
        </p>
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
                <p>
                  {c.source_scope === "GENERAL_ARCHIVED_INDEBTED_SUBSET"
                    ? "Archivo general · Sin apertura operativa"
                    : "Primer paquete de APARTADO · Apertura revisada por separado"}
                  {" · "}Corte desde{" "}
                  {new Date(c.source_at).toLocaleString("es-MX", {
                    timeZone: "America/Mexico_City",
                  })}
                </p>
                {!c.source_unchanged ? (
                  <p className={styles.notice}>
                    Origen cambiado: requiere conciliar.
                  </p>
                ) : null}
              </div>
              <Link
                href={
                  c.source_scope === "GENERAL_ARCHIVED_INDEBTED_SUBSET"
                    ? `/migracion/creditos?q=${encodeURIComponent(c.source_ref)}#documentos`
                    : `/clientes/migracion-sicar?key=${c.key}`
                }
                className="button secondary"
              >
                Consultar documentos SICAR
              </Link>
            </article>
          ))}
        </div>
        <nav
          className={styles.search}
          aria-label="Páginas del registro heredado"
        >
          {view.page > 1 ? (
            <Link className="button secondary" href={pageLink(view.page - 1)}>
              Anterior
            </Link>
          ) : null}
          {view.page < view.pages ? (
            <Link className="button primary" href={pageLink(view.page + 1)}>
              Siguiente
            </Link>
          ) : null}
        </nav>
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
        <p>
          Para cada dato nuevo o corregido, confirma que lo revisaste ahora y
          explica su fuente. El programa guarda tu usuario y la fecha de la
          declaración por campo. No vuelvas a marcar los datos que no revisaste:
          conservan su declaración anterior. Para retirar un dato, déjalo vacío
          y explica la corrección en la nota; el historial permanece.
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
                  name="expected_source_sha256"
                  value={s.field_source_sha256 ?? ""}
                />
                <input
                  type="hidden"
                  name="request"
                  value={crypto.randomUUID()}
                />
                {PILOT_COUNT_FIELDS.map(({ key, label, sourceHelp }) => {
                  const evidence = s.field_evidence?.[key];
                  return (
                    <fieldset key={key} className={pilotStyles.field}>
                      <legend>{label}</legend>
                      <label>
                        Cantidad
                        <input
                          name={key}
                          inputMode="numeric"
                          pattern="(0|[1-9][0-9]{0,5})"
                          placeholder="Pendiente"
                          defaultValue={s[key] ?? ""}
                        />
                      </label>
                      <label className={pilotStyles.confirmation}>
                        <input
                          type="checkbox"
                          className={pilotStyles.checkbox}
                          name={key + "_declared"}
                        />{" "}
                        Revisé este dato ahora y declaro esta cantidad.
                      </label>
                      <label>
                        Cómo lo comprobé
                        <input
                          name={key + "_source"}
                          maxLength={200}
                          placeholder={sourceHelp}
                          defaultValue={evidence?.declaration?.source ?? ""}
                        />
                      </label>
                      {evidence?.declaration ? (
                        <p>
                          Declaró{" "}
                          {evidence.actor_name ??
                            evidence.declaration.actor_user_id}{" "}
                          el{" "}
                          {new Date(
                            evidence.declaration.declared_at,
                          ).toLocaleString("es-MX", {
                            timeZone: "America/Mexico_City",
                          })}
                          . Fuente: {evidence.declaration.source}.{" "}
                          {evidence.status === "DECLARED_CURRENT"
                            ? "Declaración vigente para esta referencia; no es conteo certificado."
                            : "Declaración retenida: cambió la fuente, el catálogo o el saldo; requiere revisión."}
                        </p>
                      ) : (
                        <p>
                          Sin declaración de este campo.{" "}
                          {s[key] === null
                            ? "Sigue pendiente."
                            : "El borrador previo no acredita quién verificó esta cantidad."}
                        </p>
                      )}
                    </fieldset>
                  );
                })}
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
                  {comparison.available === null ||
                  !pilotEvidenceComplete(s.field_evidence)
                    ? "Comparación física pendiente."
                    : `Disponibilidad física comparativa: ${comparison.available} pieza(s). Requiere revisión; no es saldo autorizado.`}
                </p>
                <button
                  type="submit"
                  className="button primary"
                  disabled={
                    !s.catalog_current ||
                    !s.balance_current ||
                    !s.field_source_sha256
                  }
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
