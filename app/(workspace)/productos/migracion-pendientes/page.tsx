import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
import { reviewFilters, reviewMoney } from "@/lib/m9-review";
import styles from "../migracion/review.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Catálogo SICAR por revisar" };
type PendingData = {
  source_count: number;
  managed_count: number;
  pending_count: number;
  total: number;
  page: number;
  page_size: number;
  rows: {
    barcode: string;
    description: string;
    department: string;
    section: string;
    price_cents: number | null;
    retail_source: string;
    classification: string;
    reasons: string[];
    candidate_woo_ids: number[];
  }[];
};
export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requirePermission("products.read");
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL !==
    "https://zsezjtswqeijboezvado.supabase.co"
  )
    return (
      <section>
        <h1>Catálogo por revisar</h1>
        <p>Esta consulta sólo está disponible en el entorno de pruebas.</p>
      </section>
    );
  let filters;
  try {
    filters = reviewFilters(await searchParams);
  } catch {
    return (
      <section>
        <h1>Revisa los filtros</h1>
        <Link href="/productos/migracion-pendientes">Limpiar búsqueda</Link>
      </section>
    );
  }
  const { data, error } = await supabase.rpc("m9_pending_catalog", {
    p_query: filters.q,
    p_exact: filters.exact,
    p_page: filters.page,
  });
  if (error || !data)
    return (
      <section>
        <h1>Catálogo por revisar</h1>
        <p>No se pudo consultar un corte completo. Intenta de nuevo.</p>
      </section>
    );
  const result = data as PendingData,
    pages = Math.ceil(result.total / result.page_size);
  const href = (page: number) =>
    `/productos/migracion-pendientes?${new URLSearchParams({ q: filters.q, mode: filters.exact ? "exact" : "text", page: String(page) })}`;
  return (
    <section className={styles.review}>
      <header>
        <Link href="/productos/migracion">← Catálogo conciliado</Link>
        <h1>Todo SICAR: catálogo por revisar</h1>
        <p><Link href="/productos/migracion-dudas">Responder preguntas por modelo →</Link></p>
        <p>
          {result.source_count.toLocaleString("es-MX")} registros en el corte ·{" "}
          {result.managed_count.toLocaleString("es-MX")} incorporados ·{" "}
          {result.pending_count.toLocaleString("es-MX")} por revisar
        </p>
        <p>
          Estos registros conservan los datos originales de SICAR. Todavía no
          son productos aprobados: no aparecen en caja ni se envían a Woo. No se
          importaron existencias.
        </p>
        <p>
          Los datos corresponden al último archivo recibido. Antes del uso real
          actualizaremos las exportaciones.
        </p>
      </header>
      <form
        key={href(result.page)}
        method="get"
        className={styles.filters}
        action="/productos/migracion-pendientes"
      >
        <label>
          Buscar
          <input
            name="q"
            defaultValue={filters.q}
            maxLength={160}
            placeholder="Código SICAR, descripción o departamento"
          />
        </label>
        <label>
          Tipo de búsqueda
          <select name="mode" defaultValue={filters.exact ? "exact" : "text"}>
            <option value="text">Texto</option>
            <option value="exact">Código exacto / lector</option>
          </select>
        </label>
        <button className="primary-button" type="submit">
          Buscar
        </button>
        <Link href="/productos/migracion-pendientes">Limpiar</Link>
      </form>
      <p role="status">
        {result.total.toLocaleString("es-MX")} registros encontrados
        {result.total ? ` · Página ${result.page} de ${pages}` : ""}
      </p>
      {!result.rows.length && (
        <p>
          No hay resultados en esta página. Puedes buscar también en el catálogo
          conciliado.
        </p>
      )}
      <div className={styles.cards}>
        {result.rows.map((row) => (
          <article key={row.barcode} className={styles.card}>
            <h2>{row.description}</h2>
            <p className={styles.code}>
              Código SICAR: <strong>{row.barcode}</strong>
            </p>
            <p>Pendiente de revisión · No habilitado para venta</p>
            <dl>
              <div>
                <dt>Departamento</dt>
                <dd>{row.department || "Por definir"}</dd>
              </div>
              <div>
                <dt>Sección</dt>
                <dd>{row.section || "Por definir"}</dd>
              </div>
              <div>
                <dt>Precio público SICAR</dt>
                <dd>{reviewMoney(row.price_cents, "Por revisar")}</dd>
              </div>
            </dl>
            <p>
              {row.classification === "SICAR_ONLY"
                ? "Sin coincidencia web confirmada. Hay que revisar el modelo y sus atributos; no se deduce la talla por los últimos números."
                : "Hay una coincidencia o candidato web pendiente de validar. No se ha aprobado el vínculo."}
            </p>
            <details>
              <summary>Datos para la revisión</summary>
              <p>Precio original: {row.retail_source || "Sin capturar"}</p>
              <p>Clasificación del reporte: {row.classification}</p>
              <p>
                Observaciones:{" "}
                {row.reasons.join(" · ") || "Confirmar identidad y atributos"}
              </p>
              <p>
                IDs Woo candidatos:{" "}
                {row.candidate_woo_ids.join(", ") || "Ninguno"}. Son referencias
                para revisar, no vínculos aprobados.
              </p>
            </details>
          </article>
        ))}
      </div>
      <nav
        aria-label="Páginas del catálogo pendiente"
        className={styles.pagination}
      >
        {result.page > 1 && (
          <Link href={href(result.page - 1)}>← Anterior</Link>
        )}
        {result.page < pages && (
          <Link href={href(result.page + 1)}>Siguiente →</Link>
        )}
      </nav>
    </section>
  );
}
