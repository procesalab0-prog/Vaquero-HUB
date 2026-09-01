import { requirePermission } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await requirePermission("customers.manage");
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 3 && !/^\d{4}$/.test(query)) {
      return Response.json({ customers: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data, error } = await supabase.rpc("search_customers", { p_query: query, p_limit: 10 });
    if (error) throw error;
    return Response.json({ customers: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[api/clientes/buscar] failed", { message: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    return Response.json({ error: "NOT_AUTHORIZED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
