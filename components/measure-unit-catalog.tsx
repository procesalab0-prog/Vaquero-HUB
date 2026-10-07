"use client";

import { useState, useTransition } from "react";
import type { MeasureUnit } from "@/lib/measure-units";

export type CreateMeasureUnitResult =
  { ok: true; unit: MeasureUnit } | { ok: false; message: string };

export function MeasureUnitCatalog({
  units,
  unavailable = false,
  createAction,
}: {
  units: MeasureUnit[];
  unavailable?: boolean;
  createAction?: (input: {
    code: string;
    name: string;
    decimalPlaces: 0 | 3;
  }) => Promise<CreateMeasureUnitResult>;
}) {
  const [added, setAdded] = useState<MeasureUnit[]>([]);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const current = [
    ...units,
    ...added.filter(
      (unit) => !units.some((existing) => existing.code === unit.code),
    ),
  ];
  return (
    <details className="measure-unit-catalog">
      <summary>Unidades de medida</summary>
      <p>
        Una unidad no convierte cantidades: un par se registra como un par, no
        como dos piezas. Las definiciones guardadas no se pueden cambiar ni
        borrar.
      </p>
      <p className="notice">
        La operación fraccionaria sigue en preparación; crear una unidad no
        habilita todavía kilos o metros en el cobro.
      </p>
      {unavailable ? (
        <p role="alert">
          No fue posible consultar las unidades. Recarga antes de continuar.
        </p>
      ) : null}
      <ul>
        {current.map((unit) => (
          <li key={unit.code}>
            <strong>{unit.name}</strong> · {unit.code} ·{" "}
            {unit.decimal_places ? "hasta 3 decimales" : "cantidades enteras"}
          </li>
        ))}
      </ul>
      {createAction && !unavailable ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            startTransition(async () => {
              try {
                const result = await createAction({
                  code: String(data.get("code") ?? ""),
                  name: String(data.get("name") ?? ""),
                  decimalPlaces: data.get("decimals") === "3" ? 3 : 0,
                });
                if (result.ok) {
                  setAdded((previous) => [
                    ...previous.filter(
                      (unit) => unit.code !== result.unit.code,
                    ),
                    result.unit,
                  ]);
                  setFeedback({
                    error: false,
                    text: "Unidad guardada en el catálogo.",
                  });
                  form.reset();
                } else setFeedback({ error: true, text: result.message });
              } catch {
                setFeedback({
                  error: true,
                  text: "No fue posible guardar la unidad. Revisa la conexión.",
                });
              }
            });
          }}
        >
          <fieldset disabled={pending}>
            <legend>Nueva unidad</legend>
            <label>
              Clave{" "}
              <input
                name="code"
                required
                maxLength={12}
                pattern="[A-Za-z][A-Za-z0-9_]{0,11}"
                placeholder="CAJA"
                autoCapitalize="characters"
              />
            </label>
            <label>
              Nombre{" "}
              <input name="name" required maxLength={60} placeholder="Caja" />
            </label>
            <label>
              Cantidades{" "}
              <select name="decimals">
                <option value="0">Enteras</option>
                <option value="3">Hasta 3 decimales</option>
              </select>
            </label>
            <button className="secondary-button" type="submit">
              {pending ? "Guardando…" : "Agregar unidad"}
            </button>
          </fieldset>
        </form>
      ) : null}
      {feedback ? (
        <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>
      ) : null}
    </details>
  );
}
