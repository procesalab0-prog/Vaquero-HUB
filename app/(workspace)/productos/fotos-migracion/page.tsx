import Link from "next/link";
import { copyMigrationGallery, copyVariantPhotos } from "./actions";
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
  type Row = {
    product_id: string;
    name: string;
    variants: number;
    copied: number;
  };
  async function load(
    name: "read_migration_galleries" | "list_variant_photo_copies",
  ) {
    const rows: Row[] = [];
    for (let start = 0; start < 20000; start += 1000) {
      const { data, error } = await supabase
        .rpc(name)
        .order("product_id")
        .range(start, start + 999);
      if (error) return { data: [], error: true };
      rows.push(...(data as Row[]));
      if (new Set(rows.map((r) => r.product_id)).size !== rows.length)
        return { data: [], error: true };
      if (data.length < 1000) return { data: rows, error: false };
    }
    return { data: [], error: true };
  }
  const [{ data, error }, variants] = await Promise.all([
    load("read_migration_galleries"),
    load("list_variant_photo_copies"),
  ]);
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
      <h2>Fotos de cada talla y código</h2>
      <p>
        Se guardan por separado de la galería general. Las variantes sin foto
        propia quedan sin inventar una imagen.
      </p>
      {variants.error ? (
        <p>No se pudo consultar la copia de variantes.</p>
      ) : (
        <GalleryMigration
          buttonLabel="Copiar fotos de variantes"
          copyMigrationGallery={copyVariantPhotos}
          items={variants.data
            .filter(
              (r: { variants: number; copied: number }) =>
                r.copied < r.variants,
            )
            .map((r: { product_id: string; name: string }) => ({
              id: r.product_id,
              name: r.name,
            }))}
        />
      )}
    </section>
  );
}
