import "server-only";

import { cache } from "react";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type WorkspaceProfileRow = {
  id: string;
  role_id: string;
  full_name: string;
  employee_code: string;
  is_active: boolean;
  roles:
    | { code: string; name: string }
    | Array<{ code: string; name: string }>
    | null;
  user_locations: Array<{
    locations:
      | {
          id: string;
          name: string;
          code: string;
          address: string | null;
          phone: string | null;
        }
      | Array<{
          id: string;
          name: string;
          code: string;
          address: string | null;
          phone: string | null;
        }>
      | null;
  }> | null;
};

/**
 * React limita esta caché a la petición de Server Components actual. El layout y
 * la página comparten así una sola validación de sesión y una sola lectura del
 * perfil; nunca se comparte una identidad entre usuarios ni entre peticiones.
 */
export const getWorkspaceSession = cache(async () => {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;

  if (!userId)
    return { supabase, userId: null, profile: null, profileError: null };

  const { data, error } = await supabase
    .from("app_users")
    .select(
      "id, role_id, full_name, employee_code, is_active, roles(code, name), user_locations(locations(id, name, code, address, phone))",
    )
    .eq("id", userId)
    .single();

  return {
    supabase,
    userId,
    profile: data as WorkspaceProfileRow | null,
    profileError: error,
  };
});
