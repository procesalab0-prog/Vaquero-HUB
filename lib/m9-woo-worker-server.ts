import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { remoteWebConfigured } from "@/lib/remote-web-server";
import { TEST_ORIGIN } from "@/scripts/m9/woo-remote/client.mjs";
import { processTrialQueue } from "@/scripts/m9/woo-remote/trial-worker.mjs";

export async function runWooTrialQueue() {
  if (!remoteWebConfigured()) throw Error("WORKER_NOT_CONFIGURED");
  const admin = createAdminClient();
  const signal = AbortSignal.timeout(80000);
  const rpc =
    (name: string) =>
    async (action: string, input: Record<string, unknown>) => {
      signal.throwIfAborted();
      const result = await admin
        .rpc(name, { p_action: action, p_input: input })
        .abortSignal(signal);
      if (result.error) {
        if (/^[A-Z][A-Z0-9_]{4,79}$/.test(result.error.message))
          throw Error(result.error.message);
        throw Error("WORKER_DATABASE_UNAVAILABLE");
      }
      return result.data;
    };
  return processTrialQueue({
    queueRpc: rpc("m9_woo_worker"),
    orderRpc: rpc("m9_connected_woo_trial"),
    availabilityRpc: rpc("m9_connected_availability"),
    signal,
    credentials: {
      origin: TEST_ORIGIN,
      username: process.env.M9_REMOTE_WOO_USERNAME!,
      password: process.env.M9_REMOTE_WOO_PASSWORD!,
    },
  });
}
