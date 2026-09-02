import "server-only";

import { getWorkspaceSession } from "@/lib/auth/workspace-session";

export async function requirePermission(permissionCode: string) {
  const session = await getWorkspaceSession();
  if (!session?.userId) throw new Error("NOT_AUTHENTICATED");

  const { profile, supabase, userId } = session;
  if (!profile?.is_active) throw new Error("NOT_AUTHORIZED");

  const { data: permission } = await supabase
    .from("role_permissions")
    .select("permission_code")
    .eq("role_id", profile.role_id)
    .eq("permission_code", permissionCode)
    .maybeSingle();
  if (!permission) throw new Error("NOT_AUTHORIZED");

  return { supabase, userId };
}
