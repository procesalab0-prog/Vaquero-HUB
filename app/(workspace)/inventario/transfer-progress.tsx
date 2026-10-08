"use client";

import { Check, Truck } from "lucide-react";
import { useState } from "react";

import type { InventoryTransfer } from "@/lib/domain";
import {
  type TransferStage,
  transferCaption,
  transferProgress,
  transferStage,
} from "@/lib/transfer-progress";

export function TransferProgress({
  transfer,
}: {
  transfer: Pick<
    InventoryTransfer,
    "id" | "status" | "fromLocationName" | "toLocationName"
  >;
}) {
  const stage = transferStage(transfer.status);
  const cancelled = transfer.status === "CANCELLED";
  // El camino sólo avanza animado cuando el estado cambia frente a quien lo
  // mira: al enviar la mercancía o al confirmar la recepción. Al abrir la
  // lista se ve quieto, en su punto. Se ajusta durante el render, así el primer
  // cuadro ya arranca desde donde estaba y no aparece terminado para regresar.
  const [tracked, setTracked] = useState<{
    stage: TransferStage;
    from: TransferStage | null;
  }>({ stage, from: null });
  if (tracked.stage !== stage) {
    setTracked({ stage, from: tracked.stage < stage ? tracked.stage : null });
  }
  const from = tracked.stage === stage ? tracked.from : null;

  const style = {
    "--transfer-from": transferProgress(from ?? stage),
    "--transfer-to": transferProgress(stage),
  } as React.CSSProperties;

  return (
    <div
      className="transfer-progress"
      data-stage={stage}
      data-advancing={from !== null ? from : undefined}
      data-cancelled={cancelled || undefined}
      style={style}
    >
      <ol
        aria-label={`Avance del traspaso: ${transferCaption(transfer.status, transfer.fromLocationName, transfer.toLocationName)}`}
      >
        <li className={stage >= 1 ? "done" : undefined}>
          <span className="transfer-node" aria-hidden="true">
            <Check strokeWidth={3} />
          </span>
          <span>Enviado</span>
        </li>
        <li
          className={`transfer-leg${stage === 1 ? " current" : ""}${stage === 2 ? " done" : ""}`}
          aria-current={stage === 1 ? "step" : undefined}
        >
          <span
            className="transfer-track"
            aria-hidden="true"
            key={`${from ?? "x"}-${stage}`}
          >
            <i className="transfer-fill" />
            {!cancelled && stage >= 1 ? (
              <span className="transfer-head">
                <b>
                  <Truck strokeWidth={2} />
                </b>
              </span>
            ) : null}
          </span>
          <span>En tránsito</span>
        </li>
        <li
          className={stage === 2 ? "done" : undefined}
          aria-current={stage === 2 ? "step" : undefined}
        >
          <span
            className="transfer-node"
            aria-hidden="true"
            key={`fin-${from ?? "x"}-${stage}`}
          >
            <Check strokeWidth={3} />
          </span>
          <span>Recibido</span>
        </li>
      </ol>
      <p className="transfer-progress-caption">
        {transferCaption(
          transfer.status,
          transfer.fromLocationName,
          transfer.toLocationName,
        )}
      </p>
    </div>
  );
}
