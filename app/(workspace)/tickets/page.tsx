import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { cancelPosSale } from "../pos/actions";
import { TicketsRealWorkspace, type Ticket } from "./tickets-real-workspace";
import { TicketsWorkspace } from "./tickets-workspace";

export const metadata: Metadata = { title: "Tickets" };

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ ubicacion?: string }>;
}) {
  if (!isSupabaseConfigured()) return <TicketsWorkspace />;
  const { supabase, roleId, profile } = await requirePermission("pos.sell");
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
  const referenceTime = new Date().toISOString();
  if (!location?.id)
    return (
      <TicketsRealWorkspace
        tickets={[]}
        status="Sin sucursal asignada"
        referenceTime={referenceTime}
      />
    );
  const from = new Date(referenceTime);
  from.setDate(from.getDate() - 30);
  const [ticketsResult, cancelPermission] = await Promise.all([
    supabase.rpc("list_sale_tickets", {
      p_location_id: location.id,
      p_query: "",
      p_from: from.toISOString(),
      p_to: null,
      p_limit: 200,
    }),
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", roleId)
      .eq("permission_code", "sales.cancel")
      .maybeSingle(),
  ]);
  return (
    <TicketsRealWorkspace
      tickets={(ticketsResult.data ?? []) as Ticket[]}
      status={ticketsResult.error?.message}
      referenceTime={referenceTime}
      cancelSaleAction={cancelPermission.data ? cancelPosSale : undefined}
    />
  );
}
