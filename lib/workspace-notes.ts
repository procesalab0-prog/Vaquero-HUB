export type WorkspaceNote = {
  id: string;
  body: string;
  location_id: string | null;
  author_user_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  revision: number;
};

export type SaveWorkspaceNoteInput = {
  body: string; locationId: string | null; id?: string; revision?: number;
};
export type SaveWorkspaceNoteResult = { ok: true; note: WorkspaceNote } | { ok: false; message: string };

export function workspaceNoteError(message: string): string {
  if (message.includes("NOTE_CHANGED")) return "La nota cambió en otra ventana. Actualiza la lista antes de volver a editarla.";
  if (message.includes("NOTE_NOT_EDITABLE")) return "Sólo quien escribió la nota puede editarla.";
  if (message.includes("NOTE_SCOPE_IMMUTABLE")) return "No puedes cambiar la privacidad de una nota existente. Crea una nueva.";
  if (message.includes("LOCATION_NOT_ALLOWED")) return "No tienes acceso a esta sucursal para guardar la nota.";
  if (message.includes("INVALID_NOTE")) return "Escribe entre 1 y 2,000 caracteres.";
  if (message.includes("NOT_AUTHENTICATED")) return "Inicia sesión con una cuenta activa de la tienda.";
  return "No fue posible guardar la nota. Tu texto se conserva para intentarlo de nuevo.";
}
