"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import { legacyCashParts, legacyCashFailure } from "@/lib/legacy-cash";
export async function trialLegacyCash(form: FormData) {
  let status = "";
  const request = String(form.get("request") ?? "");
  try {
    if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL))
      throw Error("NOT_AUTHORIZED");
    const { supabase } = await requirePermission("credit.collect");
    const { error } = await supabase.rpc("m9_legacy_operating", {
      p_action: "REHEARSE",
      p_input: {
        request,
        cut: String(form.get("cut") ?? ""),
        account: String(form.get("account") ?? ""),
        session: String(form.get("session") ?? ""),
        parts: legacyCashParts(form),
      },
    });
    if (error) throw error;
  } catch (e) {
    status = legacyCashFailure(
      e && typeof e === "object" && "message" in e ? String(e.message) : "",
    );
  }
  revalidatePath("/clientes/heredados-sicar/caja");
  if (status) redirect("/clientes/heredados-sicar/caja?status=" + status);
  redirect(
    "/clientes/heredados-sicar/caja/recibo?ensayo=" +
      encodeURIComponent(request),
  );
}
