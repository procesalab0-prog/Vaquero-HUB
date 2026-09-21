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
          label_code: string;
          address: string | null;
          phone: string | null;
          type: string;
          is_active: boolean;
        }
      | Array<{
          id: string;
          name: string;
          code: string;
          label_code: string;
          address: string | null;
          phone: string | null;
          type: string;
          is_active: boolean;
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
      "id, role_id, full_name, employee_code, is_active, roles(code, name), user_locations(locations(id, name, code, label_code, address, phone, type, is_active))",
    )
    .eq("id", userId)
    .single();

  const profile = data as WorkspaceProfileRow | null;
  const role = Array.isArray(profile?.roles)
    ? (profile.roles[0] ?? null)
    : profile?.roles;

  // La administración es global: la selección de sucursal debe mostrar todas
  // las tiendas activas, no sólo las asignaciones heredadas. El resto de roles
  // sigue limitado por user_locations. Si esta lectura adicional falla,
  // conservamos el alcance asignado para fallar de forma segura.
  if (!error && profile?.is_active && role?.code === "ADMIN") {
    const { data: activeStores, error: activeStoresError } = await supabase
      .from("locations")
      .select("id, name, code, label_code, address, phone, type, is_active")
      .eq("is_active", true)
      .eq("type", "STORE")
      .order("name");

    if (activeStoresError) {
      console.error("[auth/getWorkspaceSession] admin locations unavailable", {
        message: activeStoresError.message,
      });
    } else {
      profile.user_locations = (activeStores ?? []).map((location) => ({
        locations: location,
      }));
    }
  }

  return {
    supabase,
    userId,
    profile,
    profileError: error,
  };
});
