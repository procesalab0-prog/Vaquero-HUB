"use client";

import { useState } from "react";
import { measureQuantityStep, parseMeasureQuantity, type MeasureUnit } from "@/lib/measure-units";

/** Keep unfinished decimal text ("1.") visible. Never charge the last valid
 * quantity while an invalid draft is displayed; callers disable submission. */
export function MeasureQuantityInput({ value, unit, maximum, label, disabled = false, onValue, onValidity }: {
  value: number;
  unit: MeasureUnit;
  maximum: number;
  label: string;
  disabled?: boolean;
  onValue: (value: number) => void;
  onValidity: (valid: boolean) => void;
}) {
  const [draft, setDraft] = useState({ source: value, text: String(value) });
  if (draft.source !== value) setDraft({ source: value, text: String(value) });
  const parsed = parseMeasureQuantity(draft.text, unit);
  const valid = parsed !== null && parsed <= maximum;
  return <input type="text" inputMode={unit.decimal_places ? "decimal" : "numeric"}
    aria-label={label} aria-invalid={!valid} value={draft.text} disabled={disabled}
    data-step={measureQuantityStep(unit)}
    onChange={(event) => {
      const text = event.target.value;
      const next = parseMeasureQuantity(text, unit);
      const accepted = next !== null && next <= maximum;
      setDraft({ source: accepted ? next : value, text });
      onValidity(accepted);
      if (accepted) onValue(next);
    }} />;
}
