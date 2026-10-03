import type { WebContent } from "@/lib/web-draft";
export function WebFields({
  content,
  nameOptional = false,
}: {
  content?: WebContent;
  nameOptional?: boolean;
}) {
  return (
    <div className="settings-form">
      <label className="wide-field">
        <span>Nombre para tienda en línea</span>
        <input
          name="web_name"
          maxLength={240}
          defaultValue={content?.name}
          required={!nameOptional}
          placeholder={nameOptional ? "Usar el nombre del producto" : undefined}
        />
      </label>
      <label className="wide-field">
        <span>Código base del modelo</span>
        <input
          name="web_base_code"
          maxLength={160}
          defaultValue={content?.base_code}
        />
        <small>
          Identifica la familia. Es distinto al código SICAR de cada talla y al
          SKU interno.
        </small>
      </label>
      <label className="wide-field">
        <span>Descripción completa</span>
        <textarea
          name="web_description"
          rows={8}
          maxLength={30000}
          defaultValue={content?.description}
        />
        <small>
          Texto comercial. Conserva los párrafos; no necesitas escribir HTML.
        </small>
      </label>
      <label className="wide-field">
        <span>Descripción corta</span>
        <textarea
          name="web_short_description"
          rows={3}
          maxLength={4000}
          defaultValue={content?.short_description}
        />
      </label>
      <label className="wide-field">
        <span>Categorías web propuestas</span>
        <textarea
          name="web_categories"
          rows={3}
          defaultValue={content?.categories.join("\n")}
        />
        <small>
          Una ruta por línea. Se revisan por separado de los departamentos y
          secciones SICAR.
        </small>
      </label>
      <label className="wide-field">
        <span>Galería de fotos</span>
        <textarea
          name="web_images"
          rows={5}
          defaultValue={content?.images
            .map((i) => i.url + (i.alt ? ` | ${i.alt}` : ""))
            .join("\n")}
        />
        <small>
          Una dirección de foto por línea, de vaquerosm.com o de esta prueba. La
          primera es la portada. Puedes añadir « | descripción de la foto» al
          final y cambiar el orden de las líneas.
        </small>
      </label>
    </div>
  );
}
