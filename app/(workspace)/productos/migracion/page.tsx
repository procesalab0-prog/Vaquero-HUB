import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
import { reviewFilters, type ReviewData } from "@/lib/m9-review";
import { MigrationReview } from "./review";

export const metadata = { title: "Revisión del piloto SICAR" };
export const dynamic = "force-dynamic";

export default async function MigrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL !==
    "https://zsezjtswqeijboezvado.supabase.co"
  ) {
    return (
      <section>
        <h1>Revisión del piloto</h1>
        <p>
          Esta consulta requiere el entorno de staging. No se muestran datos de
          demostración.
        </p>
        <Link href="/productos">Volver a Productos</Link>
      </section>
    );
  }
  const { supabase } = await requirePermission("products.read");
  let filters;
  try {
    filters = reviewFilters(await searchParams);
  } catch {
    return (
      <section>
        <h1>Revisa los filtros</h1>
        <p>La búsqueda o el número de página no son válidos.</p>
        <Link href="/productos/migracion">Limpiar filtros</Link>
      </section>
    );
  }
  const { data, error } = await supabase.rpc("m9_review_catalog", {
    p_query: filters.q,
    p_exact: filters.exact,
    p_department: filters.department,
    p_section: filters.section,
    p_page: filters.page,
  });
  if (error || !data)
    return (
      <section>
        <h1>Consulta no disponible</h1>
        <p>
          No se pudo leer el piloto de staging. Intenta de nuevo; no se han
          cambiado productos.
        </p>
        <Link href="/productos/migracion">Reintentar</Link>
      </section>
    );
  return (
    <>
      <Link href="/productos/fotos-migracion">
        Copiar fotos del catálogo conciliado
      </Link>
      <p>
        <Link href="/productos/migracion-pendientes">
          Consultar todo el catálogo pendiente de SICAR
        </Link>
      </p>
      <MigrationReview data={data as ReviewData} filters={filters} />
    </>
  );
}
