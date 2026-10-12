"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InventoryItem } from "@/lib/domain";
import {
  parseMeasureQuantity,
  quantityUnit,
  measureQuantityStep,
} from "@/lib/measure-units";
import { browserOperation } from "@/lib/browser-operations";

export function InlineInventoryQuantity({
  item,
  locationId,
  preview,
}: {
  item: InventoryItem;
  locationId: string;
  preview: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(String(item.quantity));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const unit = quantityUnit(item);
  const parsed = parseMeasureQuantity(qty, unit, true);
  const changed = parsed !== item.quantity;
  return (
    <div className="inline-inventory-quantity">
      <label>
        <span className="sr-only">
          Cantidad física de {item.productName}, {item.code}
        </span>
        <input
          inputMode="decimal"
          type="number"
          min="0"
          step={measureQuantityStep(unit)}
          value={qty}
          disabled={busy}
          onChange={(e) => setQty(e.target.value)}
        />
      </label>
      {changed ? (
        <>
          <label>
            <span className="sr-only">Motivo del ajuste de {item.code}</span>
            <input
              value={note}
              maxLength={500}
              placeholder="Motivo del ajuste"
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || parsed === null || note.trim().length < 3}
            onClick={async () => {
              if (parsed === null || busy) return;
              setBusy(true);
              setMessage("");
              try {
                const result = preview
                  ? {
                      ok: true,
                      message: "Demostración: no se guardó inventario.",
                    }
                  : await browserOperation<{ ok: boolean; message: string }>(
                      "/api/operaciones",
                      {
                        operation: "inventory.quantity",
                        input: {
                          locationId,
                          variantId: item.variantId,
                          expected: item.quantity,
                          counted: parsed,
                          note,
                        },
                      },
                    );
                setMessage(result.message);
                if (result.ok && !preview) router.refresh();
              } catch {
                setMessage(
                  "No se pudo confirmar el ajuste; recarga para revisar antes de repetir.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      ) : null}
      {message ? <small role="status">{message}</small> : null}
    </div>
  );
}
