"use server";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { WEB_STAGING_URL } from "@/lib/web-draft";
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export async function rehearseNativeWooSale(form: FormData) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL) notFound();
  const session = form.get("session_id"),
    operation = form.get("operation_id");
  let outcome = "revision",
    run = "";
  if (
    typeof session === "string" &&
    typeof operation === "string" &&
    uuid.test(session) &&
    uuid.test(operation)
  ) {
    const { supabase } = await requirePermission("pos.sell");
    const { data, error } = await supabase.rpc("m9_run_woo_native_rehearsal", {
      p_session: session,
      p_operation: operation,
    });
    if (
      !error &&
      data?.result?.all_synthetic_operations_rolled_back === true &&
      typeof data.id === "string" &&
      uuid.test(data.id)
    ) {
      outcome = "verificado";
      run = data.id;
    } else if (error?.message.includes("WOO_REHEARSAL_COOLDOWN"))
      outcome = "espera";
  }
  redirect(
    "/productos/ensayo-woo/venta?" +
      new URLSearchParams({
        estado: outcome,
        ...(run ? { ensayo: run } : {}),
      }).toString(),
  );
}
