"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceSession } from "@/lib/auth/workspace-session";
import { workspaceNoteError, type WorkspaceNote, type SaveWorkspaceNoteInput, type SaveWorkspaceNoteResult } from "@/lib/workspace-notes";

export async function saveWorkspaceNote(input: SaveWorkspaceNoteInput): Promise<SaveWorkspaceNoteResult> {
  if (typeof input.body !== "string" || !input.body.trim() || input.body.trim().length > 2000) {
    return { ok: false, message: workspaceNoteError("INVALID_NOTE") };
  }
  const session = await getWorkspaceSession();
  if (!session?.userId || !session.profile?.is_active) {
    return { ok: false, message: workspaceNoteError("NOT_AUTHENTICATED") };
  }
  // La función vuelve a verificar autor y acceso a sucursal en la base.
  const { data, error } = await session.supabase.rpc("save_workspace_note", {
    p_body: input.body.trim(), p_location_id: input.locationId,
    p_id: input.id ?? null, p_expected_revision: input.revision ?? null,
  });
  if (error || !data) return { ok: false, message: workspaceNoteError(error?.message ?? "") };
  revalidatePath("/inicio");
  return { ok: true, note: data as WorkspaceNote };
}
