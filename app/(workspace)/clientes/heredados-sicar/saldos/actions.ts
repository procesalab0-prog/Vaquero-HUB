"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import { legacyTrialCents, legacyFinanceFailure } from "@/lib/legacy-finance";
export async function trialLegacyPayment(form: FormData) {
  let status = "ensayado";
  const request = String(form.get("request") ?? "");
  try {
    if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL))
      throw Error("NOT_AUTHORIZED");
    const { supabase } = await requirePermission("credit.collect");
    const { error } = await supabase.rpc("m9_legacy_finance", {
      p_action: "TRIAL",
      p_input: {
        request,
        account: String(form.get("account") ?? ""),
        amount_cents: legacyTrialCents(String(form.get("amount") ?? "")),
      },
    });
    if (error) throw error;
  } catch (e) {
    status = legacyFinanceFailure(
      e && typeof e === "object" && "message" in e ? String(e.message) : "",
    );
  }
  revalidatePath("/clientes/heredados-sicar/saldos");
  redirect("/clientes/heredados-sicar/saldos?status=" + status);
}
