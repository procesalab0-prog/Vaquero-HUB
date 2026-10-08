import type { InventoryTransfer } from "@/lib/domain";

// Un traspaso pasa por varios estados internos, pero quien lo sigue sólo
// necesita tres momentos: salió, va en camino, llegó.
export type TransferStage = 0 | 1 | 2;

export function transferStage(
  status: InventoryTransfer["status"],
): TransferStage {
  if (status === "RECEIVED") return 2;
  if (status === "IN_TRANSIT") return 1;
  return 0;
}

// Cuánto del camino está recorrido: nada, la mitad o completo.
export function transferProgress(stage: TransferStage) {
  return stage / 2;
}

// El texto acompaña siempre al dibujo: el avance nunca depende sólo del color
// ni del movimiento.
export function transferCaption(
  status: InventoryTransfer["status"],
  fromName: string,
  toName: string,
) {
  switch (status) {
    case "REQUESTED":
      return `Solicitado · todavía no sale de ${fromName}`;
    case "APPROVED":
      return `Aprobado · todavía no sale de ${fromName}`;
    case "PREPARED":
      return `Preparado · listo para salir de ${fromName}`;
    case "IN_TRANSIT":
      return `En camino de ${fromName} a ${toName}`;
    case "RECEIVED":
      return `Recibido en ${toName}`;
    case "CANCELLED":
      return "Traspaso cancelado";
  }
}
