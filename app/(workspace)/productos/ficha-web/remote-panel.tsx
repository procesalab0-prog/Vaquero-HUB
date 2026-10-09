"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { RemoteWebResult, RemoteWebState } from "@/lib/remote-web";
export function RemoteWebPanel({
  initial,
  productId,
  revision,
  fingerprint,
  dirty,
  action,
}: {
  initial: RemoteWebState | null;
  productId: string;
  revision: number;
  fingerprint: string;
  dirty: boolean;
  action: (form: FormData) => Promise<RemoteWebResult>;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<string | null>(null);
  if (!state?.enabled) return null;
  async function run(
    enqueue: boolean,
    pullPhotos = false,
    pushPhotos = false,
    variantPhotos = false,
  ) {
    setBusy(true);
    setMessage("");
    const form = new FormData();
    form.set("product_id", productId);
    if (variantPhotos) form.set("operation", "push_variant_photos");
    if (pushPhotos) form.set("operation", "push_photos");
    if (pullPhotos) form.set("operation", "pull_photos");
    if (enqueue) {
      request.current ??= crypto.randomUUID();
      form.set("operation", "enqueue");
      form.set("request_id", request.current);
      form.set("revision", String(revision));
      form.set("fingerprint", fingerprint);
    }
    try {
      const result = await action(form);
      if (result.remote)
        setState({
          ...result.remote,
          variant_photos_enabled: state?.variant_photos_enabled,
        });
      setMessage(result.error ?? result.message ?? "Estado actualizado.");
      if (result.refresh) router.refresh();
    } catch {
      setMessage(
        "No se confirmó el envío. Actualiza el estado; tu producto sigue guardado.",
      );
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    READY: "Pendiente de envío",
    RUNNING: "Pendiente de comprobar el resultado",
    SUCCEEDED: "Recibido en Woo de pruebas",
    REVIEW_REQUIRED: "Requiere revisión",
    SUPERSEDED: "La ficha cambió antes del envío",
  };
  return (
    <section aria-label="WooCommerce de pruebas en internet">
      <h2>WooCommerce de pruebas en internet</h2>
      <p>
        Envía altas simples o familias habilitadas para pruebas. Las familias
        conservan cada talla, código, precio, categoría y foto de la ficha. Los
        productos llegan como borradores a la tienda de pruebas.
      </p>
      {state?.job ? (
        <p>
          {labels[state.job.state] ?? "Requiere revisión"}
          {state.job.remote_product_id
            ? ` · Producto Woo ${state.job.remote_product_id}`
            : ""}
        </p>
      ) : (
        <p>
          {state?.eligible
            ? "Ficha lista para este ensayo."
            : "Esta ficha todavía no cumple el alcance de este ensayo. Guarda y actualiza el estado."}
        </p>
      )}
      <button
        type="button"
        disabled={busy || dirty || !state?.eligible}
        onClick={() => run(true)}
      >
        {busy ? "Comprobando…" : "Enviar al Woo de pruebas"}
      </button>{" "}
      <button type="button" disabled={busy} onClick={() => run(false)}>
        Actualizar estado
      </button>
      {state.job?.state === "SUCCEEDED" && (
        <>
          <button
            type="button"
            disabled={busy || dirty}
            onClick={() => run(false, true)}
          >
            Traer fotos de Woo de pruebas
          </button>
          <button
            type="button"
            disabled={busy || dirty}
            onClick={() => run(false, false, true)}
          >
            Enviar fotos a Woo de pruebas
          </button>
          <p>
            Trae o envía la galería desde la última sincronización comprobada.
            Cambios en ambos lados o fotos retiradas requieren revisión. Guarda
            primero la ficha y elige la dirección del cambio.
          </p>
          {state.variant_photos_enabled && (
            <>
              <button
                type="button"
                disabled={busy || dirty}
                onClick={() => run(false, false, false, true)}
              >
                Comprobar y enviar fotos por talla
              </button>
              <p>
                Ensayo de las tallas revisadas. Conserva las que no tienen foto
                propia y consulta la misma solicitud si se interrumpe el envío.
              </p>
            </>
          )}
        </>
      )}
      {dirty && <p>Guarda los cambios de la ficha antes de enviar.</p>}
      <p role="status">{message}</p>
    </section>
  );
}
