"use client";
import { useState, useTransition } from "react";
import type { MeasureUnit } from "@/lib/measure-units";
export type SetProductUnitResult =
  { ok: true; code: string } | { ok: false; message: string };

export function ProductUnitEditor({
  productId,
  initialCode,
  units,
  action,
  onSaved,
}: {
  productId: string;
  initialCode: string;
  units: MeasureUnit[];
  onSaved?: (code: string) => void;
  action: (input: {
    productId: string;
    code: string;
    expectedCode: string;
  }) => Promise<SetProductUnitResult>;
}) {
  const [code, setCode] = useState(initialCode);
  const [savedCode, setSavedCode] = useState(initialCode);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          try {
            const result = await action({
              productId,
              code,
              expectedCode: savedCode,
            });
            if (result.ok) {
              setSavedCode(result.code);
              onSaved?.(result.code);
              setMessage({
                error: false,
                text: "Unidad guardada para todas las variantes del producto.",
              });
            } else setMessage({ error: true, text: result.message });
          } catch {
            setMessage({
              error: true,
              text: "No fue posible cambiar la unidad. Revisa la conexión.",
            });
          }
        });
      }}
    >
      <fieldset className="edit-section" disabled={pending}>
        <legend>Unidad de medida</legend>
        <label>
          Unidad{" "}
          <select
            value={code}
            onChange={(event) => setCode(event.target.value)}
          >
            {units.map((unit) => (
              <option
                key={unit.code}
                value={unit.code}
                disabled={unit.decimal_places !== 0}
              >
                {unit.name}
                {unit.decimal_places
                  ? " · operación fraccionaria pendiente"
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <p>
          Se puede asignar antes de tener existencias o documentos. No convierte
          cantidades ni reinterpreta el historial.
        </p>
        <button
          className="secondary-button"
          type="submit"
          disabled={pending || code === savedCode}
        >
          {pending ? "Guardando…" : "Guardar unidad"}
        </button>
        {message ? (
          <p role={message.error ? "alert" : "status"}>{message.text}</p>
        ) : null}
      </fieldset>
    </form>
  );
}
