"use client";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { WebFields } from "./fields";
import type { SaveWebState, WebLabState, WebLabResult } from "@/lib/web-draft";
import {
  validWebImage,
  remainingSourceVariants,
  webDraftIssues,
  type WebDraft,
  type WebContent,
} from "@/lib/web-draft";
import styles from "./web.module.css";

export function WebDraftEditor({
  draft,
  saveWebDraft,
  uploadWebPhoto,
  lab,
  webLabAction,
}: {
  draft: WebDraft;
  lab: WebLabState | null;
  webLabAction: (form: FormData) => Promise<WebLabResult>;
  saveWebDraft: (form: FormData) => Promise<SaveWebState>;
  uploadWebPhoto: (form: FormData) => Promise<{ url?: string; error?: string }>;
}) {
  const [labState, setLabState] = useState(lab);
  const [labBusy, setLabBusy] = useState(false);
  const [labError, setLabError] = useState("");
  const [dirty, setDirty] = useState(false);
  const labRequest = useRef<string | null>(null);
  const [revision, setRevision] = useState(draft.revision);
  const [result, setResult] = useState<SaveWebState | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [preview, setPreview] = useState<WebContent>(draft.content);
  const formRef = useRef<HTMLFormElement>(null);
  const requestRef = useRef<string | null>(null);
  const remainingVariants = remainingSourceVariants(draft);
  const partial = remainingVariants.length > 0;
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
        setDirty(false);
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
  async function laboratory(enqueue = false) {
    if (labBusy || busy || uploading) return;
    setLabBusy(true);
    setLabError("");
    const form = new FormData();
    form.set("product_id", draft.catalog.product_id);
    if (enqueue) {
      labRequest.current ??= crypto.randomUUID();
      form.set("operation", "enqueue");
      form.set("revision", String(revision));
      form.set("fingerprint", draft.fingerprint);
      form.set("request_id", labRequest.current);
    }
    try {
      const response = await webLabAction(form);
      if (response.lab) setLabState(response.lab);
      if (response.error) setLabError(response.error);
    } catch {
      setLabError(
        "No se pudo confirmar el estado. Actualiza antes de reintentar.",
      );
    } finally {
      setLabBusy(false);
    }
  }
  function change() {
    setDirty(true);
    labRequest.current = null;
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
      <p className={styles.notice}>Prueba en staging · Tienda real bloqueada</p>
      <p>
        {revision
          ? `Guardado interno · revisión ${revision}`
          : draft.source
            ? "Contenido propuesto de la exportación WooCommerce; pendiente de guardar y revisar."
            : "Nueva ficha pendiente de guardar."}
      </p>
      {draft.source && (
        <p>
          Producto de la tienda real: WooCommerce {draft.source.woo_product_id}.{" "}
          {partial
            ? `${remainingVariants.length} variantes adicionales fuera del piloto se conservarán.`
            : "El ensayo crea una copia separada en el laboratorio local."}
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
          disabled={!draft.can_edit || busy || uploading || labBusy}
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
      <section className={styles.preview} aria-label="Envío al laboratorio">
        <h2>Ensayo en WooCommerce local</h2>
        <p>
          Se prepara un borrador con la ficha guardada, las fotos y el precio
          público. El procesamiento es supervisado; no publica en la tienda real
          ni envía existencias.
        </p>
        {!labState && (
          <p>No se pudo consultar la disponibilidad del laboratorio.</p>
        )}
        {labState && !labState.enabled && (
          <p>Esta ficha todavía no está habilitada para el ensayo.</p>
        )}
        {labState?.job && (
          <p role="status">
            Revisión {labState.job.revision}:{" "}
            {
              {
                READY: "en espera de procesamiento supervisado",
                RUNNING: "procesamiento iniciado; no volver a enviar",
                SUCCEEDED: "borrador verificado en el laboratorio",
                REVIEW_REQUIRED: "requiere revisión antes de continuar",
                SUPERSEDED: "detenida porque cambió la ficha o su evidencia",
              }[labState.job.state]
            }
            .
          </p>
        )}
        {labState?.job?.state === "SUCCEEDED" &&
          labState.job.local_product_id && (
            <p>
              ID exclusivo del laboratorio: {labState.job.local_product_id}.{" "}
              <a
                href="http://127.0.0.1:9417/m9-laboratorio/"
                target="_blank"
                rel="noreferrer"
              >
                Ver laboratorio en este equipo
              </a>
            </p>
          )}
        {labState?.job && labState.job.revision !== revision && (
          <p>
            El resultado corresponde a una revisión anterior; los cambios nuevos
            no se han enviado.
          </p>
        )}
        {dirty && <p>Guarda tus cambios antes de solicitar el ensayo.</p>}
        <div className={styles.actions}>
          {labState?.enabled &&
            draft.can_edit &&
            (!labState.job ||
              labState.job.state === "SUPERSEDED" ||
              (labState.job.state === "SUCCEEDED" &&
                revision > labState.job.revision)) && (
              <button
                type="button"
                disabled={dirty || !revision || busy || uploading || labBusy}
                onClick={() => {
                  void laboratory(true);
                }}
              >
                {labState.local_product_id
                  ? "Preparar actualización en laboratorio"
                  : "Preparar envío al laboratorio"}
              </button>
            )}
          <button
            type="button"
            disabled={labBusy || busy || uploading}
            onClick={() => {
              void laboratory();
            }}
          >
            {labBusy ? "Consultando…" : "Actualizar estado"}
          </button>
        </div>
        {labError && <p role="alert">{labError}</p>}
      </section>
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
              {labState?.last_verified_variants?.find(
                (m) => m.variant_id === v.id,
              ) && (
                <p>
                  Verificada en Woo local:{" "}
                  {
                    labState.last_verified_variants.find(
                      (m) => m.variant_id === v.id,
                    )!.local_variation_id
                  }
                </p>
              )}
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
