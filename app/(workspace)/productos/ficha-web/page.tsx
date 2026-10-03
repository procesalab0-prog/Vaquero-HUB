import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
import { WEB_STAGING_URL, type WebDraft } from "@/lib/web-draft";
import { saveWebDraft, uploadWebPhoto, webLabAction } from "./actions";
import { WebDraftEditor } from "./editor";
export const metadata = { title: "Ficha para tienda en línea" };
export const dynamic = "force-dynamic";
export default async function WebPage({
  searchParams,
}: {
  searchParams: Promise<{
    producto?: string;
    variante?: string;
    foto?: string;
  }>;
}) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL)
    return (
      <section>
        <h1>Ficha web</h1>
        <p>Disponible en el entorno de pruebas.</p>
      </section>
    );
  const { supabase } = await requirePermission("products.read");
  const params = await searchParams;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(params.producto ?? params.variante ?? ""))
    return (
      <section>
        <h1>Selecciona un producto</h1>
        <Link href="/productos/migracion">Abrir piloto</Link>
      </section>
    );
  const { data, error } = await supabase.rpc("read_web_draft", {
    p_product_id: params.producto ?? null,
    p_variant_id: params.variante ?? null,
  });
  if (error || !data)
    return (
      <section>
        <h1>Ficha no disponible</h1>
        <p>No se pudo consultar. Vuelve a intentar desde el catálogo.</p>
        <Link href="/productos/migracion">Volver al piloto</Link>
      </section>
    );
  const draft = data as WebDraft;
  if (!draft.content.images.length && draft.catalog.image_path) {
    draft.content = {
      ...draft.content,
      images: [
        {
          url: `${WEB_STAGING_URL}/storage/v1/object/public/product-images/${draft.catalog.image_path}`,
          alt: "",
        },
      ],
    };
  }
  const { data: lab } = await supabase.rpc("read_web_lab", {
    p_product_id: draft.catalog.product_id,
  });
  return (
    <>
      {params.foto === "pendiente" && (
        <p role="alert">
          El producto y su ficha se guardaron; la foto no se pudo subir. Puedes
          añadirla aquí sin crear otro producto.
        </p>
      )}
      <WebDraftEditor
        key={data.catalog.product_id}
        draft={draft}
        lab={lab}
        webLabAction={webLabAction}
        saveWebDraft={saveWebDraft}
        uploadWebPhoto={uploadWebPhoto}
      />
    </>
  );
}
