export function draftQuantity(raw: string) {
  if (raw === "") return null;
  if (!/^(0|[1-9]\d{0,5})$/.test(raw))
    throw Error("M9_EXPLICIT_WHOLE_QUANTITY_REQUIRED");
  return Number(raw);
}
export function physicalComparison(
  physical: number | null,
  sold: number | null,
  separated: number | null,
) {
  for (const n of [physical, sold, separated])
    if (n !== null && (!Number.isSafeInteger(n) || n < 0 || n > 999999))
      throw Error("M9_EXPLICIT_WHOLE_QUANTITY_REQUIRED");
  if (physical !== null && (sold ?? 0) + (separated ?? 0) > physical)
    throw Error("M9_COMMITMENTS_EXCEED_PHYSICAL");
  return {
    complete: physical !== null && sold !== null && separated !== null,
    available:
      physical === null || sold === null || separated === null
        ? null
        : physical - sold - separated,
    import_allowed: false,
    count_certified: false,
  };
}
export function legacyPilotFailure(message: string) {
  if (message.includes("M9_PILOT_BUSY_RETRY")) return "ocupado";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "conflicto";
  if (message.includes("M9_DRAFT_REVISION_CHANGED")) return "revision";
  if (message.includes("M9_PILOT_BASELINE_CHANGED")) return "base-cambiada";
  if (message.includes("M9_FIELD_SOURCE_CHANGED")) return "base-cambiada";
  if (
    message.includes("M9_FIELD_DECLARATION_REQUIRED") ||
    message.includes("M9_FIELD_QUANTITY_REQUIRED")
  )
    return "evidencia";
  if (message.includes("M9_COMMITMENTS_EXCEED_PHYSICAL")) return "cantidades";
  if (message.includes("M9_EXPLICIT_WHOLE_QUANTITY_REQUIRED")) return "formato";
  if (message.includes("NOT_AUTHORIZED")) return "sin-permiso";
  return "error";
}
export type LegacyPilotView = {
  protocol: "m9-legacy-registry-page-1";
  read_only: true;
  registered: number;
  general_archived: number;
  total: number;
  page: number;
  pages: number;
  customers: Array<{
    id: string;
    key: string;
    name: string;
    phone: string | null;
    source_balance_cents: number;
    source_unchanged: boolean;
    source_ref: string;
    source_scope: string;
    source_at: string;
  }>;
  stock: Array<{
    barcode: string;
    name: string;
    variant_id: string;
    location_id: string;
    observed_qty: number;
    observed_at: string;
    physical_qty: number | null;
    sold_waiting_qty: number | null;
    separated_qty: number | null;
    note: string;
    revision: number;
    catalog_current: boolean;
    balance_current: boolean;
    field_source_sha256?: string;
    field_evidence?: Partial<
      Record<
        import("./legacy-pilot-declarations").PilotCountKey,
        import("./legacy-pilot-declarations").PilotFieldView
      >
    >;
  }>;
};
