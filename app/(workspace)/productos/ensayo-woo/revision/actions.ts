"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { remoteWebConfigured } from "@/lib/remote-web-server";
import { remoteOrderTrialClient } from "@/scripts/m9/woo-remote/order-trial-client.mjs";
import { TEST_ORIGIN } from "@/scripts/m9/woo-remote/client.mjs";
import { readTrialFinance } from "@/scripts/m9/woo-remote/finance-read.mjs";
export async function reviewWooFinance(form: FormData) {
  const id = String(form.get("request_id") ?? "");
  let state = "verificado";
  try {
    if (!remoteWebConfigured()) throw Error("FINANCE_NOT_CONFIGURED");
    const { userId, supabase } = await requirePermission("products.update");
    const context = await supabase.rpc("m9_woo_finance_context", {
      p_trial: id,
    });
    if (context.error) throw Error("FINANCE_NOT_AUTHORIZED");
    await readTrialFinance({
      id,
      context: context.data,
      client: remoteOrderTrialClient({
        origin: TEST_ORIGIN,
        username: process.env.M9_REMOTE_WOO_USERNAME!,
        password: process.env.M9_REMOTE_WOO_PASSWORD!,
      }),
      record: async (input: {
        id: string;
        snapshot: unknown;
        observed_at: string;
      }) => {
        const result = await createAdminClient().rpc(
          "m9_record_woo_finance_read",
          {
            p_input: {
              actor_id: userId,
              id: input.id,
              snapshot: input.snapshot,
              observed_at: input.observed_at,
            },
          },
        );
        if (result.error) throw Error("FINANCE_RECORD_REVIEW");
        return result.data;
      },
    });
  } catch (error) {
    console.error(
      "M9_FINANCE_READ",
      error instanceof Error && /^[A-Z][A-Z0-9_]{4,79}$/.test(error.message)
        ? error.message
        : "FINANCE_REVIEW_REQUIRED",
    );
    state = "revision";
  }
  revalidatePath("/productos/ensayo-woo/revision");
  redirect(
    `/productos/ensayo-woo/revision?solicitud=${encodeURIComponent(id)}&estado=${state}`,
  );
}
