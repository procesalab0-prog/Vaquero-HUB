import { createHash } from "node:crypto";
import { TEST_ORIGIN } from "./client.mjs";
export const ORDER_TRIAL_PROTOCOL = "m9-remote-order-trial-1";
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const need = (ok, code) => {
  if (!ok) throw Error(code);
};

export function phaseOperationId(trial, phase) {
  need(
    uuid.test(trial) && ["PROCESS", "CANCEL"].includes(phase),
    "TRIAL_OPERATION_INVALID",
  );
  const hex = createHash("sha256").update(`${trial}/${phase}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function validateOrderTrialSnapshot(snapshot, expected, trialId) {
  need(
    snapshot &&
      snapshot.protocol === ORDER_TRIAL_PROTOCOL &&
      snapshot.origin === TEST_ORIGIN &&
      snapshot.trial_id === trialId &&
      snapshot.parent_id === expected.parent_id &&
      snapshot.owner === expected.owner &&
      snapshot.synthetic === true &&
      snapshot.payment_executed === false &&
      snapshot.shipping_executed === false &&
      snapshot.variant_id === expected.variant_id &&
      snapshot.barcode === expected.barcode &&
      typeof snapshot.barcode === "string" &&
      snapshot.woo_product_id === expected.woo_product_id &&
      snapshot.woo_variation_id === expected.woo_variation_id &&
      snapshot.unit_price_cents === expected.unit_price_cents &&
      snapshot.quantity === expected.quantity &&
      Number.isSafeInteger(snapshot.order_id) &&
      snapshot.order_id > 0 &&
      Number.isSafeInteger(snapshot.line_id) &&
      snapshot.line_id > 0 &&
      Number.isSafeInteger(snapshot.version) &&
      snapshot.version >= 1 &&
      snapshot.version <= 3 &&
      Array.isArray(snapshot.steps) &&
      snapshot.steps.length === snapshot.version,
    "TRIAL_SNAPSHOT_IDENTITY",
  );
  const phases = ["CREATE", "PROCESS", "CANCEL"],
    statuses = ["pending", "processing", "cancelled"];
  snapshot.steps.forEach((step, i) =>
    need(
      step.phase === phases[i] &&
        step.status === statuses[i] &&
        step.version === i + 1,
      "TRIAL_JOURNAL_CHANGED",
    ),
  );
  need(
    snapshot.status === statuses[snapshot.version - 1],
    "TRIAL_STATUS_CHANGED",
  );
  return snapshot;
}

export function remoteOrderTrialClient({
  origin,
  username,
  password,
  transport = fetch,
}) {
  need(origin === TEST_ORIGIN, "TRIAL_TEST_ORIGIN_REQUIRED");
  need(
    typeof username === "string" &&
      username.length > 0 &&
      !username.includes(":") &&
      typeof password === "string" &&
      password.length > 0,
    "TRIAL_CREDENTIAL_REQUIRED",
  );
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  async function call(method, path, body) {
    need(
      (method === "GET" &&
        (path === "isolation" ||
          /^(order|availability)-trials\/[a-f0-9-]{36}$/.test(path))) ||
        (method === "POST" &&
          (["order-trials", "availability-trials"].includes(path) ||
            /^order-trials\/[a-f0-9-]{36}\/step$/.test(path))),
      "TRIAL_ROUTE_FORBIDDEN",
    );
    const response = await transport(`${origin}/wp-json/m9-test/v1/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (method === "GET" && response.status === 404) return null;
    need(response.ok, `TRIAL_HTTP_${response.status}`);
    const reader = response.body?.getReader();
    need(reader, "TRIAL_RESPONSE_EMPTY");
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        need(size <= 65536, "TRIAL_RESPONSE_TOO_LARGE");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  return {
    async availabilityPreflight() {
      const s = await this.preflight();
      need(
        s.availability_trial_protocol === "m9-remote-availability-trial-1",
        "AVAILABILITY_PROTOCOL_REQUIRED",
      );
      return s;
    },
    readAvailability(id) {
      need(uuid.test(id), "TRIAL_ID_INVALID");
      return call("GET", `availability-trials/${id}`);
    },
    applyAvailability(packet) {
      need(
        packet?.protocol === "m9-remote-availability-trial-1" &&
          uuid.test(packet.trial_id),
        "AVAILABILITY_PACKET_INVALID",
      );
      return call("POST", "availability-trials", packet);
    },
    async preflight() {
      const s = await call("GET", "isolation");
      need(
        s?.origin === TEST_ORIGIN &&
          s.order_trial_protocol === ORDER_TRIAL_PROTOCOL &&
          s.mail_blocked === true &&
          s.outbound_blocked === true &&
          s.purchase_blocked === true &&
          s.orders_blocked === true &&
          s.payment_gateways === 0,
        "TRIAL_ISOLATION_REQUIRED",
      );
      return s;
    },
    read(id) {
      need(uuid.test(id), "TRIAL_ID_INVALID");
      return call("GET", `order-trials/${id}`);
    },
    create(packet) {
      need(
        packet?.protocol === ORDER_TRIAL_PROTOCOL &&
          uuid.test(packet.trial_id) &&
          uuid.test(packet.parent_id) &&
          typeof packet.barcode === "string" &&
          packet.barcode.length > 0 &&
          Number.isInteger(packet.quantity) &&
          packet.quantity >= 1 &&
          packet.quantity <= 3,
        "TRIAL_PACKET_INVALID",
      );
      return call("POST", "order-trials", packet);
    },
    step(id, phase, version) {
      need(
        uuid.test(id) &&
          ["PROCESS", "CANCEL"].includes(phase) &&
          version === (phase === "PROCESS" ? 1 : 2),
        "TRIAL_STEP_INVALID",
      );
      return call("POST", `order-trials/${id}/step`, {
        protocol: ORDER_TRIAL_PROTOCOL,
        operation_id: phaseOperationId(id, phase),
        expected_version: version,
        phase,
      });
    },
  };
}

// Claim is durable before remote writes. Unknown creation outcomes are GET-only.
export async function processConnectedWooTrial({
  id,
  parentId,
  actorId,
  rpc,
  client,
}) {
  need(
    uuid.test(id) && uuid.test(parentId) && uuid.test(actorId),
    "TRIAL_ID_INVALID",
  );
  await client.preflight();
  const queued = await rpc("INIT", {
    id,
    parent_id: parentId,
    actor_id: actorId,
  });
  if (queued.state === "VERIFIED") return { ...queued.result, replayed: true };
  let snapshot = await client.read(id);
  if (!snapshot && queued.dispatch === true) {
    try {
      await client.create(queued.packet);
    } catch {
      /* Read receipt; never create with another UUID. */
    }
    snapshot = await client.read(id);
  }
  need(snapshot, "TRIAL_CREATION_UNCERTAIN");
  validateOrderTrialSnapshot(snapshot, queued.expected, id);
  for (const [phase, version] of [
    ["PROCESS", 1],
    ["CANCEL", 2],
  ]) {
    if (snapshot.version !== version) continue;
    try {
      await client.step(id, phase, version);
    } catch {
      /* The canonical GET decides outcome. */
    }
    const latest = await client.read(id);
    validateOrderTrialSnapshot(latest, queued.expected, id);
    need(
      latest.order_id === snapshot.order_id &&
        latest.line_id === snapshot.line_id &&
        latest.version === version + 1,
      "TRIAL_STEP_UNCERTAIN",
    );
    snapshot = latest;
  }
  need(
    snapshot.version === 3 && snapshot.status === "cancelled",
    "TRIAL_NOT_CANCELLED",
  );
  const stable = await client.read(id);
  validateOrderTrialSnapshot(stable, queued.expected, id);
  need(
    JSON.stringify(stable) === JSON.stringify(snapshot),
    "TRIAL_READ_CHANGED",
  );
  return rpc("FINISH", {
    id,
    actor_id: actorId,
    snapshot,
    observed_at: new Date().toISOString(),
  });
}
