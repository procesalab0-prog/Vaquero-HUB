import "server-only";

import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceIdentity } from "@/lib/auth/types";

type ProfileRow = {
  id: string;
  full_name: string;
  employee_code: string;
  is_active: boolean;
  roles: { code: string; name: string } | Array<{ code: string; name: string }> | null;
  user_locations: Array<{
    locations: { id: string; name: string; code: string; address: string | null; phone: string | null } | Array<{ id: string; name: string; code: string; address: string | null; phone: string | null }> | null;
  }> | null;
};

function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function getWorkspaceIdentity(): Promise<WorkspaceIdentity | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (!userId) redirect("/login");

  const { data, error } = await supabase
    .from("app_users")
    .select("id, full_name, employee_code, is_active, roles(code, name), user_locations(locations(id, name, code, address, phone))")
    .eq("id", userId)
    .single();

  const profile = data as ProfileRow | null;
  if (error || !profile?.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=sin-acceso");
  }

  const role = first(profile.roles);
  const locations = (profile.user_locations ?? [])
    .map((entry) => first(entry.locations))
    .filter((location): location is { id: string; name: string; code: string; address: string | null; phone: string | null } => Boolean(location));

  return {
    id: profile.id,
    name: profile.full_name,
    employeeCode: profile.employee_code,
    role: role?.name ?? "Empleado",
    roleCode: role?.code ?? "EMPLOYEE",
    locations,
  };
}
