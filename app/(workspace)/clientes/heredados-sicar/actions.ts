"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import {
  draftQuantity,
  physicalComparison,
  legacyPilotFailure,
} from "@/lib/legacy-pilot";
export async function saveLegacyPilotDraft(form: FormData) {
  let status = "guardado";
  try {
    if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL))
      throw Error("NOT_AUTHORIZED");
    const { supabase } = await requirePermission("inventory.count");
    const physical = draftQuantity(String(form.get("physical_qty") ?? ""));
    const sold = draftQuantity(String(form.get("sold_waiting_qty") ?? ""));
    const separated = draftQuantity(String(form.get("separated_qty") ?? ""));
    physicalComparison(physical, sold, separated);
    const { error } = await supabase.rpc("m9_legacy_pilot", {
      p_action: "SAVE_STOCK_DRAFT",
      p_input: {
        request: String(form.get("request") ?? ""),
        barcode: String(form.get("barcode") ?? ""),
        revision: String(form.get("revision") ?? ""),
        physical_qty: physical,
        sold_waiting_qty: sold,
        separated_qty: separated,
        note: String(form.get("note") ?? "").trim(),
      },
    });
    if (error) throw error;
  } catch (e) {
    status = legacyPilotFailure(
      e && typeof e === "object" && "message" in e ? String(e.message) : "",
    );
  }
  revalidatePath("/clientes/heredados-sicar");
  redirect("/clientes/heredados-sicar?status=" + status + "#piloto");
}
