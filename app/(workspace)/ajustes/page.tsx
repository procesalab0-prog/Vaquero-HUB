import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { saveMySupervisorPin, saveReturnPolicy } from "./actions";
import { SettingsWorkspace } from "./settings-workspace";

export const metadata: Metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  if (!isSupabaseConfigured()) return <SettingsWorkspace />;
  const { supabase, roleId } = await requirePermission("returns.create");
  const [policies, permission] = await Promise.all([
    supabase.from("return_policies").select("location_id, window_days"),
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", roleId)
      .eq("permission_code", "returns.policy_manage")
      .maybeSingle(),
  ]);
  return (
    <SettingsWorkspace
      returnPolicies={
        (policies.data ?? []) as Array<{
          location_id: string;
          window_days: number;
        }>
      }
      canManageReturnPolicy={Boolean(permission.data)}
      saveReturnPolicyAction={saveReturnPolicy}
      saveMySupervisorPinAction={saveMySupervisorPin}
    />
  );
}
