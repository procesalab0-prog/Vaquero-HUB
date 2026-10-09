import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceSession } from "@/lib/auth/workspace-session";
async function notificationSession() {
  const session = await getWorkspaceSession();
  if (!session?.userId || !session.profile?.is_active)
    throw new Error("NOT_AUTHORIZED");
  return session;
}
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await notificationSession();
    const location = request.nextUrl.searchParams.get("ubicacion");
    const after = request.nextUrl.searchParams.get("after");
    if (!location || (after !== null && !/^\d{1,15}$/.test(after)))
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    const { data, error } = await supabase.rpc(
      "list_operational_notifications",
      { p_location_id: location, p_after_id: after ? Number(after) : null },
    );
    if (error)
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    return NextResponse.json(
      { notifications: data ?? [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  try {
    const { supabase } = await notificationSession();
    const input = (await request.json()) as {
      locationId?: string;
      ids?: number[];
    };
    if (
      !input.locationId ||
      !Array.isArray(input.ids) ||
      input.ids.length > 50 ||
      input.ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
    )
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    const { error } = await supabase.rpc("ack_operational_notifications", {
      p_location_id: input.locationId,
      p_ids: input.ids,
    });
    return NextResponse.json(
      { ok: !error },
      {
        status: error ? 403 : 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }
}
