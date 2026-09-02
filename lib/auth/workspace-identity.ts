import "server-only";

import { redirect } from "next/navigation";

import type { WorkspaceIdentity } from "@/lib/auth/types";
import { getWorkspaceSession } from "@/lib/auth/workspace-session";

function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function getWorkspaceIdentity(): Promise<WorkspaceIdentity | null> {
  const session = await getWorkspaceSession();
  if (!session) return null;
  if (!session.userId) redirect("/login");

  const { profile, profileError, supabase } = session;
  if (profileError || !profile?.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=sin-acceso");
  }

  const role = first(profile.roles);
  const locations = (profile.user_locations ?? [])
    .map((entry) => first(entry.locations))
    .filter(
      (
        location,
      ): location is {
        id: string;
        name: string;
        code: string;
        address: string | null;
        phone: string | null;
      } => Boolean(location),
    );

  return {
    id: profile.id,
    name: profile.full_name,
    employeeCode: profile.employee_code,
    role: role?.name ?? "Empleado",
    roleCode: role?.code ?? "EMPLOYEE",
    locations,
  };
}
