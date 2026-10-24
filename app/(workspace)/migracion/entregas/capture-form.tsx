"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CaptureContext,
  DeliveryCaptureState,
} from "@/lib/m9-delivery-capture";
import styles from "./review.module.css";
const initial: DeliveryCaptureState = { status: "idle", message: "" };
export function DeliveryCaptureForm({
  archive,
  document,
  context,
  generic,
  requestId,
  revokeRequestId,
  saveAction,
  compact = false,
  documentLabel = "este folio",
}: {
  compact?: boolean;
  documentLabel?: string;
  archive: string;
  document: string;
  context: CaptureContext;
  generic: boolean;
  requestId: string;
  revokeRequestId: string;
  saveAction: (
    previous: DeliveryCaptureState,
    form: FormData,
  ) => Promise<DeliveryCaptureState>;
}) {
  const [state, action, pending] = useActionState(saveAction, initial),
    [choice, setChoice] = useState(""),
    [undo, setUndo] = useState(false),
    router = useRouter();
  const common = (
    <>
      <input type="hidden" name="archive_sha256" value={archive} />
      <input type="hidden" name="document_key" value={document} />
      <input
        type="hidden"
        name="expected_archive_payload_hash"
        value={context.archive_payload_hash}
      />
      <input
        type="hidden"
        name="expected_document_snapshot_hash"
        value={context.document_snapshot_hash}
      />
      <input type="hidden" name="expected_revision" value={context.revision} />
    </>
  );
  return (
    <div
      className={
        compact ? `${styles.capture} ${styles.compactCapture}` : styles.capture
      }
    >
      <p>
        Esta declaración se guarda con tu usuario y la evidencia mostrada. No
        registra una entrega física.
      </p>
      {generic ? (
        <p>
          Este documento contiene deuda genérica: sólo se puede dejar sin
          confirmar; no conocemos sus piezas físicas.
        </p>
      ) : null}
      {state.status === "saved" ? (
        <>
          <p role="status">{state.message}</p>
          <button
            className="button primary"
            type="button"
            onClick={() => router.refresh()}
          >
            Actualizar revisión
          </button>
        </>
      ) : (
        <>
          <form key={undo ? "revoke" : "observe"} action={action}>
            {common}
            <input
              type="hidden"
              name="request_id"
              value={undo ? revokeRequestId : requestId}
            />
            <input
              type="hidden"
              name="action"
              value={undo ? "REVOKE" : "OBSERVE"}
            />
            <input
              type="hidden"
              name="revokes_request_id"
              value={undo ? (context.latest_request_id ?? "") : ""}
            />
            {undo ? (
              <>
                <input type="hidden" name="choice" value="" />
                <p>
                  Se retirará la última declaración. El evento original seguirá
                  en el historial.
                </p>
              </>
            ) : (
              <fieldset disabled={pending}>
                <legend>Selecciona una respuesta para este folio</legend>
                {compact ? (
                  <select
                    aria-label={`Declaración documental para ${documentLabel}`}
                    name="choice"
                    value={choice}
                    onChange={(event) => setChoice(event.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Elige una declaración…
                    </option>
                    <option value="ALL_PENDING" disabled={generic}>
                      Todo pendiente
                    </option>
                    <option value="ALL_DELIVERED" disabled={generic}>
                      Todo entregado
                    </option>
                    <option value="PARTIAL_REVIEW" disabled={generic}>
                      Parcial: falta revisar
                    </option>
                    <option value="UNKNOWN">Aún sin confirmar</option>
                  </select>
                ) : (
                  <>
                    {[
                      ["ALL_PENDING", "Todo está pendiente de entregar"],
                      ["ALL_DELIVERED", "Ya se entregó todo"],
                      [
                        "PARTIAL_REVIEW",
                        "Se entregó una parte; falta revisar el detalle",
                      ],
                      ["UNKNOWN", "Aún no lo puedo confirmar"],
                    ].map(([v, label]) => (
                      <label key={v}>
                        <input
                          type="radio"
                          name="choice"
                          value={v}
                          checked={choice === v}
                          onChange={() => setChoice(v)}
                          disabled={generic && v !== "UNKNOWN"}
                          required
                        />
                        {label}
                      </label>
                    ))}
                  </>
                )}
              </fieldset>
            )}
            <label>
              <input
                type="checkbox"
                name="confirmed"
                value="yes"
                required
                disabled={pending}
              />
              Confirmo que es mi declaración sobre este documento; no una orden
              de entrega o cobro.
            </label>
            <button
              className="button primary"
              type="submit"
              disabled={pending || (!undo && !choice)}
            >
              {pending
                ? "Guardando…"
                : undo
                  ? "Confirmar retirada documental"
                  : "Guardar declaración documental"}
            </button>
          </form>
          {context.status === "LIVE" ? (
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                setUndo(!undo);
                setChoice("");
              }}
            >
              {undo ? "Cancelar retirada" : "Retirar la última declaración"}
            </button>
          ) : null}
          {state.status === "error" ? (
            <div>
              <p role="alert">{state.message}</p>
              <button
                className="button secondary"
                type="button"
                onClick={() => router.refresh()}
              >
                Actualizar documento antes de reintentar
              </button>
            </div>
          ) : null}
        </>
      )}
      <p>
        Si eliges parcial o sin confirmar, el documento sigue en revisión. No se
        crean cantidades ni movimientos.
      </p>
    </div>
  );
}
