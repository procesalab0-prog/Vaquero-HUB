import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import {
  buildPilotCountWorksheet,
  renderPilotCountWorksheet,
} from "@/lib/pilot-count-worksheet.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL))
    return new Response("No disponible", { status: 404 });
  const { supabase } = await requirePermission("inventory.count");
  const { data, error } = await supabase.rpc("m9_legacy_registry_read", {
    p_input: { q: "", page: 1 },
  });
  if (error?.code === "42501")
    return new Response("No disponible", { status: 404 });
  if (
    error ||
    data?.protocol !== "m9-legacy-registry-page-1" ||
    data?.read_only !== true
  )
    return new Response("No se pudo preparar la hoja. Recarga la revisión.", {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  // The existing RPC enforces ADMIN, customers.manage, stage and location.
  // Only stock fields enter the worksheet; customers and their PII are omitted.
  try {
    const sheet = buildPilotCountWorksheet(data.stock, {
      generated_at: new Date().toISOString(),
      source_kind: "RPC_READ_NOW",
      source_label: "Hoja existente de staging · m9_legacy_registry_read",
    });
    return new Response(renderPilotCountWorksheet(sheet), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'inline; filename="piloto-la-piedad.html"',
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(
      "Cambió el alcance de la hoja. Revisa los doce códigos.",
      {
        status: 409,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
