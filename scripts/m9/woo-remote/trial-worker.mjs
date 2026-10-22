import { createHash, timingSafeEqual } from "node:crypto";
import {
  processConnectedWooTrial,
  remoteOrderTrialClient,
} from "./order-trial-client.mjs";
import { processAvailability } from "./process-availability.mjs";

export function workerAuthorized(authorization, expectedHash) {
  if (
    typeof expectedHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedHash) ||
    typeof authorization !== "string" ||
    !/^Bearer [a-f0-9]{64}$/.test(authorization)
  )
    return false;
  const actual = createHash("sha256").update(authorization.slice(7)).digest();
  return timingSafeEqual(actual, Buffer.from(expectedHash, "hex"));
}
export function workerError(error) {
  if (
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    (error instanceof TypeError && error.message === "fetch failed")
  )
    return "WORKER_NETWORK_TIMEOUT";
  return typeof error?.message === "string" &&
    /^[A-Z][A-Z0-9_]{4,79}$/.test(error.message)
    ? error.message
    : "WORKER_REVIEW_REQUIRED";
}

// One persisted phase, bounded by a deadline shorter than the database lease.
// Dependencies injected for failure tests; production callers supply server-only RPCs.
export async function processTrialQueue({
  queueRpc,
  orderRpc,
  availabilityRpc,
  credentials,
  transport = fetch,
  signal = AbortSignal.timeout(80000),
}) {
  signal.throwIfAborted();
  const job = await queueRpc("CLAIM", {});
  if (!job?.id) return { state: "IDLE" };
  const fence = { id: job.id, lease_token: job.lease_token };
  const check = async () => {
    signal.throwIfAborted();
    const current = await queueRpc("CHECK", fence);
    if (current?.ok !== true || current.phase !== job.phase)
      throw Error("WORKER_LEASE_LOST");
  };
  const client = remoteOrderTrialClient({
    ...credentials,
    transport: async (url, init) => {
      await check();
      return transport(url, {
        ...init,
        signal: AbortSignal.any([signal, init.signal]),
      });
    },
  });
  try {
    if (job.phase === "ORDER") {
      await processConnectedWooTrial({
        id: job.id,
        actorId: job.actor_id,
        parentId: job.parent_id,
        client,
        rpc: async (action, input) => {
          await check();
          return orderRpc(action, input);
        },
      });
    } else if (job.phase === "AVAILABILITY") {
      await processAvailability({
        id: job.id,
        actorId: job.actor_id,
        client,
        rpc: async (action, input) => {
          await check();
          return availabilityRpc(action, input);
        },
      });
    } else throw Error("WORKER_PHASE_INVALID");
    await check();
    return await queueRpc("COMPLETE", fence);
  } catch (error) {
    const code = workerError(error);
    // Lost leases/windows cannot be acknowledged by an old worker, even as failure.
    if (code === "WORKER_LEASE_LOST" || code === "WORKER_WINDOW_REQUIRED")
      return { state: "STOPPED", code };
    try {
      return await queueRpc("FAIL", { ...fence, code });
    } catch {
      return { state: "UNCONFIRMED", code };
    }
  }
}
