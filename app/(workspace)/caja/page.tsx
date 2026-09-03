import type { Metadata } from "next";
import { CashRegister } from "./cash-register";
import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  addCashMovement,
  closeCashSession,
  createCashRegister,
  openCashSession,
  previewCashClose,
} from "./actions";

export const metadata: Metadata = { title: "Caja" };

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ ubicacion?: string }>;
}) {
  if (!isSupabaseConfigured()) return <CashRegister preview />;
  const { supabase, roleId, profile } = await requirePermission("cash.open");
  const params = await searchParams;
  const locations = (profile?.user_locations ?? []).flatMap((entry) =>
    Array.isArray(entry.locations)
      ? entry.locations
      : entry.locations
        ? [entry.locations]
        : [],
  );
  const location =
    locations.find((entry) => entry.id === params.ubicacion) ?? locations[0];
  if (!location?.id)
    return (
      <CashRegister
        registers={[]}
        session={null}
        status="Sin sucursal asignada"
      />
    );
  const [registersResult, sessionResult, managePermission] = await Promise.all([
    supabase.rpc("list_cash_registers", { p_location_id: location.id }),
    supabase.rpc("get_my_cash_session"),
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", roleId)
      .eq("permission_code", "locations.manage")
      .maybeSingle(),
  ]);
  return (
    <CashRegister
      locationId={location.id}
      canManageRegisters={Boolean(managePermission.data)}
      registers={(registersResult.data ?? []) as never[]}
      session={(sessionResult.data as never) ?? null}
      status={registersResult.error?.message || sessionResult.error?.message}
      openAction={openCashSession}
      createRegisterAction={createCashRegister}
      movementAction={addCashMovement}
      previewCloseAction={previewCashClose}
      closeAction={closeCashSession}
    />
  );
}
