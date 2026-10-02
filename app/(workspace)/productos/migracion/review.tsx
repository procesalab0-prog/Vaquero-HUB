import Link from "next/link";
import {
  reviewHref,
  reviewMoney,
  type ReviewData,
  type ReviewFilters,
} from "../../../../lib/m9-review";
import styles from "./review.module.css";

export function MigrationReview({
  data,
  filters,
}: {
  data: ReviewData;
  filters: ReviewFilters;
}) {
  const pages = Math.ceil(data.total / data.page_size);
  return (
    <section className={styles.review}>
      <header>
        <Link href="/productos">← Productos</Link>
        <h1>Revisión del piloto</h1>
        <p>Catálogo de pruebas · Solo consulta · Existencias no importadas</p>
      </header>
      <form
        method="get"
        className={styles.filters}
        action="/productos/migracion"
      >
        <label>
          Buscar
          <input
            name="q"
            defaultValue={filters.q}
            maxLength={160}
            placeholder="Código SICAR, modelo, talla o nombre"
            autoComplete="off"
          />
        </label>
        <label>
          Tipo de búsqueda
          <select name="mode" defaultValue={filters.exact ? "exact" : "text"}>
            <option value="text">Modelo o texto</option>
            <option value="exact">Código SICAR exacto / lector</option>
          </select>
        </label>
        <label>
          Departamento
          <select name="department" defaultValue={filters.department}>
            <option value="">Todos</option>
            {data.departments.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Sección
          <select name="section" defaultValue={filters.section}>
            <option value="">Todas</option>
            {Array.from(
              new Set([
                ...data.sections,
                ...(filters.section ? [filters.section] : []),
              ]),
            ).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="submit">
          Buscar
        </button>
        <Link href="/productos/migracion">Limpiar filtros</Link>
      </form>
      <p role="status">
        {data.total} variantes encontradas
        {data.total > 0 ? ` · Página ${data.page} de ${pages}` : ""}
      </p>
      {data.rows.length === 0 && (
        <p>
          No hay coincidencias en esta página del piloto. Esto no confirma que
          el producto no exista en SICAR.
        </p>
      )}
      <div className={styles.cards}>
        {data.rows.map((row) => (
          <article key={row.id} className={styles.card}>
            <h2>{row.name}</h2>
            <p className={styles.code}>
              Código SICAR: <strong>{row.barcode}</strong>
            </p>
            <p>
              {Object.entries(row.attributes)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ") || "Producto sin variantes de talla o color"}{" "}
              · {row.is_active ? "Activo" : "Inactivo"}
            </p>
            <dl>
              <div>
                <dt>Departamento</dt>
                <dd>{row.department}</dd>
              </div>
              <div>
                <dt>Sección</dt>
                <dd>{row.section}</dd>
              </div>
              <div>
                <dt>Precio público</dt>
                <dd>{reviewMoney(row.price_cents, "Sin definir")}</dd>
              </div>
              {data.can_view_cost && (
                <div>
                  <dt>Costo</dt>
                  <dd>{reviewMoney(row.cost_cents, "Sin capturar")}</dd>
                </div>
              )}
              <div>
                <dt>Mayoreo</dt>
                <dd>{reviewMoney(row.wholesale_cents, "Sin definir")}</dd>
              </div>
              <div>
                <dt>Medio mayoreo</dt>
                <dd>
                  {reviewMoney(row.medium_wholesale_cents, "Sin definir")}
                </dd>
              </div>
            </dl>
            <details>
              <summary>Identificación y vínculo web</summary>
              <p>Descripción SICAR: {row.source_description}</p>
              <p>SKU interno: {row.sku}</p>
              <p>
                WooCommerce: producto {row.woo_product_id}
                {row.woo_variation_id
                  ? ` · variación ${row.woo_variation_id}`
                  : ""}
              </p>
              <p>
                Fotos y descripción comercial: pendientes de incorporar al
                sistema.
              </p>
            </details>
          </article>
        ))}
      </div>
      <nav aria-label="Páginas del piloto" className={styles.pagination}>
        {data.page > 1 && (
          <Link href={reviewHref(filters, data.page - 1)}>← Anterior</Link>
        )}
        {data.page < pages && (
          <Link href={reviewHref(filters, data.page + 1)}>Siguiente →</Link>
        )}
      </nav>
    </section>
  );
}
