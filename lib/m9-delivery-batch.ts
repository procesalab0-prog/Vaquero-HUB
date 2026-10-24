import type { DeliveryCapturePage } from "./m9-delivery-capture";

type Document = DeliveryCapturePage["rows"][number];

// A folio-level documentary worksheet. It does not assess financial eligibility
// or turn an original quantity into a current commitment or physical balance.
export function deliveryBatchRow(document: Document) {
  const genericLines = document.lines.filter(
    (line) => line.generic_debt,
  ).length;
  const unresolvedLines = document.lines.filter(
    (line) => line.identity_kind === "UNRESOLVED",
  ).length;
  const live = document.capture_context.status === "LIVE";
  const concrete =
    live &&
    genericLines === 0 &&
    ["ALL_PENDING", "ALL_DELIVERED"].includes(document.documentary_statement);
  const declaration =
    document.capture_context.status === "STALE"
      ? "Evidencia cambiada: revisar otra vez"
      : document.capture_context.status === "REVOKED"
        ? "Última declaración retirada"
        : !live
          ? "Sin respuesta"
          : ({
              ALL_PENDING: "Declarado todo pendiente",
              ALL_DELIVERED: "Declarado todo entregado",
              MIXED: "Parcial: falta el detalle",
              UNKNOWN: "Sin confirmar",
            }[document.documentary_statement] ?? "Sin confirmar");
  return {
    documentKey: document.document_key,
    lineCount: document.lines.length,
    genericLines,
    unresolvedLines,
    declaration,
    documentaryReview: concrete ? ("CONCRETE" as const) : ("PENDING" as const),
    sourcePhysicalStatus: "UNKNOWN" as const,
    committedQuantity: null,
    stockAllowed: false as const,
    financialOpening: "NOT_ASSESSED" as const,
  };
}

export function deliveryBatchScope(rows: Document[]) {
  return {
    documents: rows.length,
    sourceLines: rows.reduce(
      (count, document) => count + document.lines.length,
      0,
    ),
    // Count documentary rows, never pieces. SX00000 cannot represent inventory.
    genericLines: rows.reduce(
      (count, document) => count + deliveryBatchRow(document).genericLines,
      0,
    ),
    physicalQuantities: null,
    stockAllowed: false as const,
    financialOpening: "NOT_ASSESSED" as const,
  };
}
