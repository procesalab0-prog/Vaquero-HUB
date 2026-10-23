export const PILOT_COUNT_FIELDS = [
  {
    key: "physical_qty",
    label: "Total físico presente",
    sourceHelp: "Ejemplo: conteo de anaquel y bodega de esta tienda",
  },
  {
    key: "sold_waiting_qty",
    label: "Ya vendido y guardado para entregar",
    sourceHelp: "Ejemplo: ventas revisadas contra mercancía guardada",
  },
  {
    key: "separated_qty",
    label: "Separado sin venta registrada",
    sourceHelp: "Ejemplo: revisión de mercancía separada sin venta",
  },
] as const;
export type PilotCountKey = (typeof PILOT_COUNT_FIELDS)[number]["key"];
export type PilotFieldView = {
  status:
    | "UNKNOWN"
    | "UNATTRIBUTED_DRAFT"
    | "DECLARED_CURRENT"
    | "HELD_SOURCE_OR_BASELINE_CHANGED";
  actor_name: string | null;
  declaration: {
    kind: "HUMAN_DECLARATION_NOW";
    quantity: number;
    source: string;
    actor_user_id: string;
    declared_at: string;
    captured_revision: number;
    source_snapshot_sha256: string;
    count_certified: false;
  } | null;
};
export function pilotCountDeclarations(
  quantities: Record<PilotCountKey, number | null>,
  fields: Record<PilotCountKey, { declared: string | null; source: string }>,
) {
  const result: Partial<
    Record<PilotCountKey, { declared_now: true; source: string }>
  > = {};
  for (const { key } of PILOT_COUNT_FIELDS) {
    const { declared, source: raw } = fields[key];
    if (declared === null) continue;
    if (declared !== "on") throw Error("M9_FIELD_DECLARATION_REQUIRED");
    if (quantities[key] === null) throw Error("M9_FIELD_QUANTITY_REQUIRED");
    const source = raw.trim();
    if (
      source.length < 5 ||
      source.length > 200 ||
      [...source].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      throw Error("M9_FIELD_DECLARATION_REQUIRED");
    result[key] = { declared_now: true, source };
  }
  return result;
}
export function pilotEvidenceComplete(
  fields: Partial<Record<PilotCountKey, PilotFieldView>> | undefined,
) {
  return PILOT_COUNT_FIELDS.every(
    ({ key }) =>
      fields?.[key]?.status === "DECLARED_CURRENT" &&
      fields[key]?.declaration?.kind === "HUMAN_DECLARATION_NOW" &&
      fields[key]?.declaration?.count_certified === false &&
      Number.isSafeInteger(fields[key]?.declaration?.quantity) &&
      (fields[key]?.declaration?.quantity ?? -1) >= 0,
  );
}
