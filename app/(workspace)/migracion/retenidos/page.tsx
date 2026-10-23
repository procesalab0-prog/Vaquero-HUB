import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import {
  HELD_REASON_LABELS,
  heldReferenceQuery,
  heldReferenceHref,
  isHeldReferenceView,
  type HeldReason,
} from "@/lib/m9-held-references";
import styles from "./review.module.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Referencias SICAR retenidas" };
const decisions: Record<
  HeldReason,
  { title: string; explanation: string; choices: string[] }
> = {
  DISPLAY_OR_SALES_RESTRICTION: {
    title: "Exhibición: conservar fuera de venta",
    explanation:
      "La regla ya está confirmada. Estas muestras o referencias restringidas no se convierten en productos vendibles. No hace falta volver a preguntar lo mismo por cada código.",
    choices: [],
  },
  TAXONOMY_REVIEW: {
    title: "Revisar departamento o sección por grupos",
    explanation:
      "Falta una clasificación válida o una regla de clasificación confirmada. Revisaremos los grupos con ejemplos; no pediremos revisar todos los códigos uno por uno.",
    choices: [
      "Corregir el departamento o sección en SICAR y renovar el archivo.",
      "Conservar estas referencias pendientes mientras se revisa el grupo.",
    ],
  },
  PUBLIC_PRICE_INVALID: {
    title: "Separar decimales extra de precio cero",
    explanation:
      "Se conserva el Precio1 textual exactamente como llegó. No redondeamos importes ni sustituimos datos pendientes por un precio inventado.",
    choices: [
      "Validar una regla para los importes con decimales extra, con una muestra previa.",
      "Confirmar por separado el precio público de los registros en cero.",
    ],
  },
  CATEGORY_CONFLICT: {
    title: "Resolver el nombre o estado de la sección",
    explanation:
      "La sección literal de SICAR entra en conflicto con una categoría existente. No la activamos ni reasignamos automáticamente.",
    choices: [
      "Confirmar qué sección debe conservarse antes de preparar otro lote.",
      "Mantener el caso como referencia hasta corregir la clasificación.",
    ],
  },
};
export default async function HeldReferences({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { profile, supabase } = await requirePermission("products.read");
  const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
  if (role?.code !== "ADMIN") notFound();
  let query;
  try {
    query = heldReferenceQuery(await searchParams);
  } catch {
    return (
      <section className={styles.page}>
        <h1>Revisa los filtros</h1>
        <Link href="/migracion/retenidos">Limpiar búsqueda</Link>
      </section>
    );
  }
  const { data, error } = await supabase.rpc("m9_held_reference_read", {
    p_input: query,
  });
  if (error?.code === "42501") notFound();
  if (error || !isHeldReferenceView(data))
    throw Error("No se pudo consultar el índice de referencias retenidas.");
  if (!data.ready)
    return (
      <section className={styles.page}>
        <h1>Referencias retenidas</h1>
        <p>
          El índice todavía no está disponible. No se habilitó ningún producto.
        </p>
        <Link href="/migracion">Volver a migración</Link>
      </section>
    );
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Preview · Sólo consulta ADMIN</p>
        <h1>Referencias SICAR retenidas</h1>
        <p>
          {data.total_references} códigos conservados como referencia; no son
          altas de catálogo vendible.
        </p>
        <Link className="button secondary" href="/migracion">
          Volver al centro de migración
        </Link>
      </header>
      <section className={styles.notice}>
        <h2>Guardar una referencia no habilita su venta</h2>
        <p>
          Índice del corte SICAR del 22 de octubre: reutiliza 433 referencias
          históricas sin copiarlas y conserva dos cambios de proyección
          separados. El archivo anterior mantiene su fecha del 7 de octubre. No
          se crean variantes, existencias, precios operativos ni vínculos Woo.
        </p>
        <p>
          Los motivos se superponen: un mismo código puede aparecer en dos
          grupos. Se cuentan {data.total_references} códigos únicos, no la suma
          de las tarjetas. Estas referencias no aumentan el porcentaje de
          catálogo activo.
        </p>
        {data.origin_changed > 0 && (
          <p role="status">
            {data.origin_changed} referencias originales cambiaron: sus detalles
            quedan retenidos.
          </p>
        )}
        {data.current_catalog_overlap > 0 && (
          <p>
            {data.current_catalog_overlap} códigos ya aparecen ahora en
            catálogo; esta consulta conserva su referencia histórica y no los
            autoriza a vender.
          </p>
        )}
      </section>
      <section aria-labelledby="decisiones-titulo">
        <h2 id="decisiones-titulo">Próxima revisión: por tipo, con ejemplos</h2>
        <p>
          Este bloque sólo reúne la cola. Aquí todavía no se envían preguntas ni
          se guardan respuestas.
        </p>
        <div className={styles.cards}>
          {(Object.keys(HELD_REASON_LABELS) as HeldReason[]).map((reason) => (
            <article key={reason} className={styles.card}>
              <strong className={styles.count}>
                {data.reason_counts[reason]}
              </strong>
              <h3>{decisions[reason].title}</h3>
              <p>{decisions[reason].explanation}</p>
              {reason === "PUBLIC_PRICE_INVALID" && (
                <p>
                  <b>{data.price_subgroups.extra_decimals}</b> con decimales
                  extra y <b>{data.price_subgroups.zero}</b> con precio cero.
                  Son dos revisiones distintas.
                </p>
              )}
              {decisions[reason].choices.length > 0 && (
                <ul>
                  {decisions[reason].choices.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              <details>
                <summary>Ver ejemplos del grupo</summary>
                <ul>
                  {data.examples[reason].map((e) => (
                    <li key={e.barcode}>
                      {e.description ?? "Origen cambiado, por revisar"} · Código{" "}
                      <code>{e.barcode}</code>
                      {reason === "PUBLIC_PRICE_INVALID" &&
                        e.retail_source !== null && (
                          <>
                            {" "}
                            · Precio1 literal: <code>{e.retail_source}</code>
                          </>
                        )}
                    </li>
                  ))}
                </ul>
              </details>
              <Link
                className="button secondary"
                href={heldReferenceHref(
                  { ...query, q: "", exact: false },
                  1,
                  reason,
                )}
              >
                Consultar este grupo
              </Link>
            </article>
          ))}
        </div>
      </section>
      <form className={styles.filters} method="get">
        <label>
          Buscar código o descripción
          <input
            name="q"
            defaultValue={query.q}
            maxLength={160}
            placeholder="Código SICAR o nombre"
          />
        </label>
        <label>
          Coincidencia
          <select name="mode" defaultValue={query.exact ? "exact" : "text"}>
            <option value="text">Texto</option>
            <option value="exact">Código exacto</option>
          </select>
        </label>
        <label>
          Motivo
          <select name="reason" defaultValue={query.reason}>
            <option value="ALL">Todos los motivos</option>
            {(Object.keys(HELD_REASON_LABELS) as HeldReason[]).map((r) => (
              <option key={r} value={r}>
                {HELD_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" type="submit">
          Buscar referencias
        </button>
        <Link href="/migracion/retenidos">Limpiar filtros</Link>
      </form>
      <p>
        {data.total} resultados · Página {query.page} de {pages}
      </p>
      <div className={styles.references}>
        {data.rows.map((row) => (
          <article className={styles.reference} key={row.barcode}>
            <p className={styles.badge}>
              {row.display_restricted
                ? "Sólo exhibición / venta restringida"
                : "Referencia retenida · Sin alta vendible"}
            </p>
            <h2>
              {row.projection?.description ??
                "Detalle original cambiado, pendiente de revisión"}
            </h2>
            <p>
              Clave1 / código SICAR: <code>{row.barcode}</code>
            </p>
            <ul>
              {row.reasons.map((r) => (
                <li key={r}>{HELD_REASON_LABELS[r]}</li>
              ))}
            </ul>
            {row.projection && (
              <dl>
                <div>
                  <dt>Departamento de origen</dt>
                  <dd>
                    {row.projection.department || "Sin definir en origen"}
                  </dd>
                </div>
                <div>
                  <dt>Sección de origen</dt>
                  <dd>{row.projection.section || "Sin definir en origen"}</dd>
                </div>
                <div>
                  <dt>Precio1 literal, sólo referencia</dt>
                  <dd>
                    <code>{row.projection.retail_source}</code>
                    {row.reasons.includes("PUBLIC_PRICE_INVALID") &&
                      " · Sin precio operativo válido"}
                  </dd>
                </div>
              </dl>
            )}
            <p>Sin botones de venta, entrega, inventario o envío Woo.</p>
          </article>
        ))}
      </div>
      {data.rows.length === 0 && <p>No hay referencias con estos filtros.</p>}
      <nav
        className={styles.pagination}
        aria-label="Páginas de referencias retenidas"
      >
        {query.page > 1 && (
          <Link
            className="button secondary"
            href={heldReferenceHref(query, query.page - 1)}
          >
            ← Anterior
          </Link>
        )}
        {query.page < pages && (
          <Link
            className="button secondary"
            href={heldReferenceHref(query, query.page + 1)}
          >
            Siguiente →
          </Link>
        )}
      </nav>
    </div>
  );
}
