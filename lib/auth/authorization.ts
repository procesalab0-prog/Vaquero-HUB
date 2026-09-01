import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function requirePermission(permissionCode: string) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (!userId) throw new Error("NOT_AUTHENTICATED");

  const { data: profile } = await supabase
    .from("app_users")
    .select("role_id, is_active")
    .eq("id", userId)
    .single();
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
