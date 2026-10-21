"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";
import { remoteWebConfigured } from "@/lib/remote-web-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEST_ORIGIN } from "@/scripts/m9/woo-remote/client.mjs";
import {
  processConnectedWooTrial,
  remoteOrderTrialClient,
} from "@/scripts/m9/woo-remote/order-trial-client.mjs";

export async function runConnectedWooTrial(form: FormData) {
  const id = String(form.get("request_id") ?? "");
  const parentId = String(form.get("parent_id") ?? "");
  let status = "verificado";
  try {
    if (!remoteWebConfigured()) throw Error("TRIAL_NOT_CONFIGURED");
    const { userId, supabase } = await requirePermission("products.update");
    const allowed = await supabase.rpc("m9_connected_woo_status");
    if (allowed.error) throw Error("TRIAL_NOT_AUTHORIZED");
    const admin = createAdminClient();
    await processConnectedWooTrial({
      id,
      parentId,
      actorId: userId,
      rpc: async (action: string, input: Record<string, unknown>) => {
        const result = await admin.rpc("m9_connected_woo_trial", {
          p_action: action,
          p_input: input,
        });
        if (result.error)
          throw Error(
            result.error.message.match(/\b[A-Z][A-Z0-9_]{4,}\b/)?.[0] ??
              "TRIAL_DATABASE_REVIEW",
          );
        return result.data;
      },
      client: remoteOrderTrialClient({
        origin: TEST_ORIGIN,
        username: process.env.M9_REMOTE_WOO_USERNAME!,
        password: process.env.M9_REMOTE_WOO_PASSWORD!,
      }),
    });
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]{4,}$/.test(error.message)
        ? error.message
        : "TRIAL_REVIEW_REQUIRED";
    console.error("M9_CONNECTED_WOO_TRIAL", code);
    status = "revision";
  }
  revalidatePath("/productos/ensayo-woo");
  redirect(
    `/productos/ensayo-woo?estado=${status}&solicitud=${encodeURIComponent(id)}&familia=${encodeURIComponent(parentId)}`,
  );
}
