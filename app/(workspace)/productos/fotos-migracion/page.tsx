import Link from "next/link";
import { copyMigrationGallery } from "./actions";
import { requirePermission } from "@/lib/auth/authorization";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import { GalleryMigration } from "./review";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const metadata = { title: "Fotos del catálogo conciliado" };
export default async function Page() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL)
    return <p>Disponible en pruebas.</p>;
  const { supabase } = await requirePermission("products.update");
  const { data, error } = await supabase.rpc("read_migration_galleries");
  if (error) return <p>No se pudo consultar el catálogo conciliado.</p>;
  return (
    <section>
      <Link href="/productos/migracion">Volver a revisión</Link>
      <h1>Fotos del catálogo conciliado</h1>
      <p>
        Copiamos las fotos vinculadas a cada producto al almacenamiento de Mi
        Tienda. Se conservan orden, portada y descripciones. Los casos que
        necesiten revisión quedan separados.
      </p>
      <GalleryMigration
        copyMigrationGallery={copyMigrationGallery}
        items={data.map((r: { product_id: string; name: string }) => ({
          id: r.product_id,
          name: r.name,
        }))}
      />
    </section>
  );
}
