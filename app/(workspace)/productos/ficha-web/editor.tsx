"use client";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { WebFields } from "./fields";
import type { SaveWebState } from "@/lib/web-draft";
import {
  validWebImage,
  webDraftIssues,
  type WebDraft,
  type WebContent,
} from "@/lib/web-draft";
import styles from "./web.module.css";

export function WebDraftEditor({
  draft,
  saveWebDraft,
  uploadWebPhoto,
}: {
  draft: WebDraft;
  saveWebDraft: (form: FormData) => Promise<SaveWebState>;
  uploadWebPhoto: (form: FormData) => Promise<{ url?: string; error?: string }>;
}) {
  const [revision, setRevision] = useState(draft.revision);
  const [result, setResult] = useState<SaveWebState | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [preview, setPreview] = useState<WebContent>(draft.content);
  const formRef = useRef<HTMLFormElement>(null);
  const requestRef = useRef<string | null>(null);
  const partial = Boolean(draft.source?.unselected_woo_variation_ids.length);
  async function save(form: FormData) {
    if (busy || uploading) return;
    setBusy(true);
    requestRef.current ??= crypto.randomUUID();
    form.set("request_id", requestRef.current);
    form.set("revision", String(revision));
    try {
      const state = await saveWebDraft(form);
      setResult(state);
      if (state.ok) {
        setRevision(state.revision!);
        requestRef.current = null;
      }
    } catch {
      setResult({
        ok: false,
        message:
          "No se confirmó el guardado. Tus cambios siguen aquí; reintenta.",
      });
    } finally {
      setBusy(false);
    }
  }
  function change() {
    requestRef.current = null;
    setResult(null);
  }
  async function photo(form: FormData) {
    if (uploading || busy) return;
    setUploading(true);
    setUploadMessage("");
    try {
      form.set("product_id", draft.catalog.product_id);
      const response = await uploadWebPhoto(form);
      if (response.url && formRef.current) {
        const field = formRef.current.elements.namedItem(
          "web_images",
        ) as HTMLTextAreaElement;
        field.value = [field.value.trim(), response.url]
          .filter(Boolean)
          .join("\n");
        change();
        setUploadMessage(
          "Foto añadida a la galería. Guarda la ficha para conservar su asociación.",
        );
      } else setUploadMessage(response.error ?? "No se subió la foto.");
    } catch {
      setUploadMessage(
        "No se confirmó la subida. Revisa tu conexión y vuelve a intentar.",
      );
    } finally {
      setUploading(false);
    }
  }
  function showPreview() {
    if (!formRef.current) return;
    const f = new FormData(formRef.current);
    const images = String(f.get("web_images") ?? "")
      .split(/\r?\n/)
      .filter((v) => v.trim())
      .map((line) => {
        const [url, ...alt] = line.split(" | ");
        return { url: url.trim(), alt: alt.join(" | ") };
      })
      .filter((i) => validWebImage(i.url));
    setPreview({
      name: String(f.get("web_name") ?? ""),
      description: String(f.get("web_description") ?? ""),
      short_description: String(f.get("web_short_description") ?? ""),
      base_code: String(f.get("web_base_code") ?? ""),
      categories: String(f.get("web_categories") ?? "")
        .split(/\r?\n/)
        .filter(Boolean),
      images,
    });
  }
  return (
    <section className={styles.page}>
      <Link href="/productos/migracion">← Revisar piloto</Link>
      <h1>Ficha para tienda en línea</h1>
      <p>{draft.catalog.name}</p>
      <p className={styles.notice}>
        Prueba en staging · Envío a WooCommerce desactivado
      </p>
      <p>
        {revision
          ? `Guardado interno · revisión ${revision}`
          : draft.source
            ? "Contenido propuesto de la exportación WooCommerce; pendiente de guardar y revisar."
            : "Nueva ficha pendiente de guardar."}
      </p>
      {draft.source && (
        <p>
          Producto WooCommerce {draft.source.woo_product_id}.{" "}
          {partial
            ? `${draft.source.unselected_woo_variation_ids.length} variantes adicionales fuera del piloto se conservarán.`
            : "Vínculo existente: no se creará otro producto."}
        </p>
      )}
      <form
        ref={formRef}
        onChange={change}
        onSubmit={(event) => {
          event.preventDefault();
          void save(new FormData(event.currentTarget));
        }}
      >
        <input
          type="hidden"
          name="product_id"
          value={draft.catalog.product_id}
        />
        <input type="hidden" name="fingerprint" value={draft.fingerprint} />
        <fieldset
          disabled={!draft.can_edit || busy || uploading}
          className={styles.fields}
        >
          <WebFields content={draft.content} />
          <div className={styles.actions}>
            {draft.can_edit && (
              <button className="primary-button" type="submit">
                {busy ? "Guardando…" : "Guardar ficha"}
              </button>
            )}
            <button type="button" onClick={showPreview}>
              Ver vista previa
            </button>
          </div>
        </fieldset>
        {!draft.can_edit && (
          <p>Tu rol permite consultar esta ficha, pero no editarla.</p>
        )}
        {result && (
          <p role={result.ok ? "status" : "alert"}>{result.message}</p>
        )}
        {result?.conflict && (
          <button type="button" onClick={() => window.location.reload()}>
            Recargar después de copiar mis cambios
          </button>
        )}
      </form>
      {draft.can_edit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void photo(new FormData(event.currentTarget));
          }}
          className={styles.upload}
        >
          <label>
            Subir una foto desde este dispositivo
            <input
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/webp"
              required
              disabled={busy || uploading}
            />
          </label>
          <button type="submit" disabled={busy || uploading}>
            {uploading ? "Subiendo…" : "Añadir foto"}
          </button>
          <small>
            Hasta 4 MB. La foto queda en almacenamiento de staging; guarda
            después la ficha.
          </small>
          {uploadMessage && <p role="status">{uploadMessage}</p>}
        </form>
      )}
      <section className={styles.preview} aria-label="Vista previa comercial">
        <h2>Vista previa comercial</h2>
        <p>Revisa con «Ver vista previa» los cambios aún sin guardar.</p>
        <h3>{preview.name}</h3>
        <p>Código base: {preview.base_code || "Sin capturar"}</p>
        <div className={styles.gallery}>
          {preview.images
            .filter((i) => validWebImage(i.url))
            .map((i, index) => (
              <figure key={i.url}>
                <Image
                  unoptimized
                  src={i.url}
                  width={180}
                  height={180}
                  alt={i.alt || `Foto ${index + 1} del producto`}
                  referrerPolicy="no-referrer"
                />
                <figcaption>
                  {index === 0 ? "Portada" : `Foto ${index + 1}`}
                </figcaption>
              </figure>
            ))}
        </div>
        <p className={styles.copy}>{preview.short_description}</p>
        <p className={styles.copy}>{preview.description}</p>
        <h3>Pendientes antes de enviar</h3>
        <ul>
          {webDraftIssues(preview, partial).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        <p>
          El primer envío se preparará como borrador. Esta pantalla no publica
          ni cambia promociones.
        </p>
      </section>
      <section>
        <h2>Variantes vinculadas</h2>
        <p>
          Precios públicos del catálogo. Códigos, atributos y precios se
          consultan aquí; guardar textos no los cambia.
        </p>
        <div className={styles.variants}>
          {draft.catalog.variants.map((v) => (
            <article key={v.id}>
              <strong>Código {v.barcode}</strong>
              <p>
                {Object.entries(v.attributes)
                  .map(([k, value]) => `${k}: ${value}`)
                  .join(" · ") || "Sin variantes de talla o color"}
              </p>
              <p>
                {v.department} {v.section ? `· ${v.section}` : ""}
              </p>
              <p>
                {new Intl.NumberFormat("es-MX", {
                  style: "currency",
                  currency: "MXN",
                }).format(v.price_cents / 100)}{" "}
                · {v.active ? "Activo" : "Inactivo"}
              </p>
              <p>SKU interno: {v.sku}</p>
              <p>
                {v.woo_product_id
                  ? `WooCommerce ${v.woo_product_id}${v.woo_variation_id ? ` / ${v.woo_variation_id}` : ""}`
                  : "Sin vínculo WooCommerce"}
              </p>
            </article>
          ))}
        </div>
      </section>
      {draft.source?.variants.some((v) => v.sale_price_woo) && (
        <details>
          <summary>Promociones de la exportación (referencia)</summary>
          <ul>
            {draft.source.variants
              .filter((v) => v.sale_price_woo)
              .map((v) => (
                <li key={v.barcode}>
                  Código {v.barcode}: precio promocional {v.sale_price_woo};{" "}
                  {v.promotion_start || "sin fecha inicial"} —{" "}
                  {v.promotion_end || "sin fecha final"}.
                </li>
              ))}
          </ul>
          <p>No se sustituyen ni activan promociones al guardar esta ficha.</p>
        </details>
      )}
    </section>
  );
}
