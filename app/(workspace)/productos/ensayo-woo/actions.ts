"use server";
import { redirect } from "next/navigation";
import { refreshWooSchedulerIdentity } from "@/lib/m9-woo-worker-server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";
import { remoteWebConfigured } from "@/lib/remote-web-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEST_ORIGIN } from "@/scripts/m9/woo-remote/client.mjs";
import { processAvailability } from "@/scripts/m9/woo-remote/process-availability.mjs";
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

export async function runAvailabilityTrial(form: FormData) {
  const id = String(form.get("request_id") ?? "");
  let status = "verificado";
  try {
    if (!remoteWebConfigured()) throw Error("TRIAL_NOT_CONFIGURED");
    const { userId, supabase } = await requirePermission("products.update");
    const allowed = await supabase.rpc("m9_connected_woo_status");
    if (allowed.error) throw Error("TRIAL_NOT_AUTHORIZED");
    const admin = createAdminClient();
    await processAvailability({
      id,
      actorId: userId,
      rpc: async (action: string, input: Record<string, unknown>) => {
        const result = await admin.rpc("m9_connected_availability", {
          p_action: action,
          p_input: input,
        });
        if (result.error)
          throw Error(
            result.error.message.match(/\b[A-Z][A-Z0-9_]{4,}\b/)?.[0] ??
              "AVAILABILITY_DATABASE_REVIEW",
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
        : "AVAILABILITY_REVIEW_REQUIRED";
    console.error("M9_AVAILABILITY_TRIAL", code);
    status = "revision";
  }
  revalidatePath("/productos/ensayo-woo");
  redirect(`/productos/ensayo-woo?estado_disponibilidad=${status}`);
}

export async function runInventoryProbe(
  _previous: string,
  form: FormData,
): Promise<string> {
  try {
    if (!remoteWebConfigured()) throw Error("TRIAL_NOT_CONFIGURED");
    const { userId, supabase } = await requirePermission("products.update");
    const allowed = await supabase.rpc("m9_connected_woo_status");
    if (allowed.error) throw Error("TRIAL_NOT_AUTHORIZED");
    const phase = String(form.get("phase") ?? "");
    if (!["HOLDER", "CONTENDER"].includes(phase))
      throw Error("CONTENTION_ACTION_INVALID");
    const result = await createAdminClient().rpc(
      "m9_inventory_contention_probe",
      {
        p_action: phase,
        p_actor: userId,
        p_trial: String(form.get("trial_id") ?? ""),
      },
    );
    if (result.error)
      throw Error(
        result.error.message.match(/\b[A-Z][A-Z0-9_]{4,}\b/)?.[0] ??
          "CONTENTION_REVIEW",
      );
    return JSON.stringify(result.data);
  } catch (error) {
    return error instanceof Error && /^[A-Z][A-Z0-9_]{4,}$/.test(error.message)
      ? error.message
      : "CONTENTION_REVIEW";
  }
}

export async function enqueueWooTrial(form: FormData) {
  const id = String(form.get("request_id") ?? "");
  const parentId = String(form.get("parent_id") ?? "");
  let status = "guardado";
  try {
    if (!remoteWebConfigured()) throw Error("WORKER_NOT_CONFIGURED");
    const { userId, supabase } = await requirePermission("products.update");
    const allowed = await supabase.rpc("m9_woo_worker_status");
    if (allowed.error) throw Error("NOT_AUTHORIZED");
    await refreshWooSchedulerIdentity();
    const result = await createAdminClient().rpc("m9_woo_worker", {
      p_action: "ENQUEUE",
      p_input: { actor_id: userId, id, parent_id: parentId },
    });
    if (result.error) throw Error("WORKER_ENQUEUE_REVIEW");
  } catch {
    status = "revision";
  }
  revalidatePath("/productos/ensayo-woo");
  redirect(
    `/productos/ensayo-woo?cola=${status}&solicitud=${encodeURIComponent(id)}&familia=${encodeURIComponent(parentId)}`,
  );
}
