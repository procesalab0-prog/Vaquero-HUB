import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  workerAuthorized,
  workerError,
  processTrialQueue,
} from "../../scripts/m9/woo-remote/trial-worker.mjs";
import { TEST_ORIGIN } from "../../scripts/m9/woo-remote/client.mjs";
const id = "fa7c3585-be58-45af-94f7-ee4839f06b03";
const parent = "97c82026-b3cc-4c60-8f22-13d7c00fb33a";
const job = {
  id,
  parent_id: parent,
  actor_id: "22222222-2222-4222-8222-222222222222",
  phase: "ORDER",
  lease_token: "fenced",
};
const token = "a".repeat(64),
  hash = createHash("sha256").update(token).digest("hex");
function setup() {
  const queueRpc = vi.fn(async (action) =>
    action === "CLAIM"
      ? job
      : action === "CHECK"
        ? { ok: true, phase: "ORDER" }
        : { state: "READY", phase: "AVAILABILITY" },
  );
  const transport = vi.fn().mockRejectedValue(Error("TRIAL_HTTP_503"));
  return {
    queueRpc,
    transport,
    orderRpc: vi.fn(),
    availabilityRpc: vi.fn(),
    credentials: { origin: TEST_ORIGIN, username: "test", password: "fixture" },
  };
}
describe("background trial queue", () => {
  it("accepts only the scoped bearer preimage", () =>
    expect(workerAuthorized(`Bearer ${token}`, hash)).toBe(true));
  for (const auth of [
    null,
    "",
    `Basic ${token}`,
    `Bearer ${"b".repeat(64)}`,
    `Bearer ${token} `,
    `Bearer ${token.toUpperCase()}`,
  ]) {
    it(`rejects invalid authorization ${String(auth).slice(0, 8)}`, () =>
      expect(workerAuthorized(auth, hash)).toBe(false));
  }
  it("rejects an unset or invalid server digest", () => {
    expect(workerAuthorized(`Bearer ${token}`, undefined)).toBe(false);
    expect(workerAuthorized(`Bearer ${token}`, "a")).toBe(false);
  });
  it("does no remote work with no claim", async () => {
    const s = setup();
    s.queueRpc.mockResolvedValue({});
    expect(await processTrialQueue(s)).toEqual({ state: "IDLE" });
    expect(s.transport).not.toHaveBeenCalled();
  });
  it("checks the fence before any remote call and records transient failure", async () => {
    const s = setup();
    await processTrialQueue(s);
    expect(s.queueRpc.mock.calls.map((c) => c[0])).toEqual([
      "CLAIM",
      "CHECK",
      "FAIL",
    ]);
    expect(s.queueRpc.mock.calls[2][1]).toEqual({
      id,
      lease_token: "fenced",
      code: "TRIAL_HTTP_503",
    });
    expect(s.orderRpc).not.toHaveBeenCalled();
  });
  it("stops when its lease has been replaced", async () => {
    const s = setup();
    s.queueRpc.mockImplementation(async (action) => {
      if (action === "CLAIM") return job;
      throw Error("WORKER_LEASE_LOST");
    });
    expect(await processTrialQueue(s)).toEqual({
      state: "STOPPED",
      code: "WORKER_LEASE_LOST",
    });
    expect(s.transport).not.toHaveBeenCalled();
    expect(s.queueRpc.mock.calls.map((c) => c[0])).toEqual(["CLAIM", "CHECK"]);
  });
  it("stops when the window closes", async () => {
    const s = setup();
    s.queueRpc.mockImplementation(async (action) => {
      if (action === "CLAIM") return job;
      throw Error("WORKER_WINDOW_REQUIRED");
    });
    expect((await processTrialQueue(s)).state).toBe("STOPPED");
    expect(s.transport).not.toHaveBeenCalled();
  });
  it("does not leak error messages into the queue", async () => {
    const s = setup();
    s.transport.mockRejectedValue(Error("contains credential / customer data"));
    await processTrialQueue(s);
    expect(s.queueRpc.mock.calls.at(-1)[1].code).toBe("WORKER_REVIEW_REQUIRED");
  });
  it("holds failure acknowledgement loss without claiming completion", async () => {
    const s = setup();
    const original = s.queueRpc.getMockImplementation();
    s.queueRpc.mockImplementation(async (action, input) => {
      if (action === "FAIL") throw Error("offline");
      return original(action, input);
    });
    expect((await processTrialQueue(s)).state).toBe("UNCONFIRMED");
  });
  it("does not start an expired budget", async () => {
    const s = setup();
    s.signal = AbortSignal.abort();
    await expect(processTrialQueue(s)).rejects.toThrow();
    expect(s.queueRpc).not.toHaveBeenCalled();
  });
  it("recovers both persisted phases without another remote POST", async () => {
    const s = setup();
    let phase = "ORDER";
    s.queueRpc.mockImplementation(async (action) =>
      action === "CLAIM"
        ? { ...job, phase }
        : action === "CHECK"
          ? { ok: true, phase }
          : phase === "ORDER"
            ? { state: "READY", phase: "AVAILABILITY" }
            : { state: "DONE" },
    );
    const guards = {
      origin: TEST_ORIGIN,
      order_trial_protocol: "m9-remote-order-trial-1",
      availability_trial_protocol: "m9-remote-availability-trial-1",
      mail_blocked: true,
      outbound_blocked: true,
      purchase_blocked: true,
      orders_blocked: true,
      payment_gateways: 0,
    };
    const packet = {
      protocol: "m9-remote-availability-trial-1",
      trial_id: id,
      quantities: [3, 1, 0, 1, 1, 3],
    };
    const expected = {
      barcode: "01001",
      woo_product_id: 25,
      woo_variation_id: 27,
    };
    const stock = {
      variation: { manage_stock: false, quantity: null, status: "instock" },
      parent: { manage_stock: false, quantity: null, status: "outofstock" },
    };
    const receipt = {
      ...packet,
      ...expected,
      origin: TEST_ORIGIN,
      synthetic: true,
      restored: true,
      before: stock,
      after: stock,
    };
    s.orderRpc.mockResolvedValue({
      state: "VERIFIED",
      result: { replayed: true },
    });
    s.availabilityRpc.mockResolvedValue({
      state: "VERIFIED",
      packet,
      expected,
      receipt,
    });
    s.transport.mockImplementation(
      async () => new Response(JSON.stringify(guards)),
    );
    expect(await processTrialQueue(s)).toEqual({
      state: "READY",
      phase: "AVAILABILITY",
    });
    phase = "AVAILABILITY";
    expect(await processTrialQueue(s)).toEqual({ state: "DONE" });
    expect(s.orderRpc).toHaveBeenCalledTimes(1);
    expect(s.availabilityRpc).toHaveBeenCalledTimes(1);
    expect(s.transport).toHaveBeenCalledTimes(2);
    expect(
      s.transport.mock.calls.every(([, init]) => init.method === "GET"),
    ).toBe(true);
  });
  it("a lost create response followed by a connection failure recovers the same order", async () => {
    const s = setup();
    let claimed = false,
      remote = null,
      readLost = false,
      posts = 0;
    const expected = {
      parent_id: parent,
      owner: 2,
      variant_id: "6a73351b-91d3-49d5-8064-0a052ccbf851",
      barcode: "01001",
      quantity: 2,
      woo_product_id: 25,
      woo_variation_id: 27,
      unit_price_cents: 82000,
    };
    const make = (v) => ({
      ...expected,
      protocol: "m9-remote-order-trial-1",
      origin: TEST_ORIGIN,
      trial_id: id,
      order_id: 901,
      line_id: 902,
      version: v,
      status: ["pending", "processing", "cancelled"][v - 1],
      steps: ["CREATE", "PROCESS", "CANCEL"]
        .slice(0, v)
        .map((phase, i) => ({
          phase,
          status: ["pending", "processing", "cancelled"][i],
          version: i + 1,
        })),
      synthetic: true,
      payment_executed: false,
      shipping_executed: false,
    });
    s.orderRpc.mockImplementation(async (action) => {
      if (action === "INIT") {
        const dispatch = !claimed;
        claimed = true;
        return {
          state: "DISPATCHING",
          dispatch,
          expected,
          packet: {
            protocol: "m9-remote-order-trial-1",
            trial_id: id,
            parent_id: parent,
            barcode: "01001",
            quantity: 2,
          },
        };
      }
      return { order_id: 901 };
    });
    s.transport.mockImplementation(async (url, init) => {
      if (url.endsWith("/isolation"))
        return new Response(
          JSON.stringify({
            origin: TEST_ORIGIN,
            order_trial_protocol: "m9-remote-order-trial-1",
            mail_blocked: true,
            outbound_blocked: true,
            purchase_blocked: true,
            orders_blocked: true,
            payment_gateways: 0,
          }),
        );
      if (init.method === "GET") {
        if (readLost) {
          readLost = false;
          return new Response("offline", { status: 503 });
        }
        return new Response(JSON.stringify(remote), {
          status: remote ? 200 : 404,
        });
      }
      if (url.endsWith("/order-trials")) {
        posts++;
        remote = make(1);
        readLost = true;
        throw new DOMException("lost after commit", "TimeoutError");
      }
      remote = make(remote.version + 1);
      return new Response(JSON.stringify(remote));
    });
    await processTrialQueue(s);
    expect(s.queueRpc.mock.calls.at(-1)[1].code).toBe("TRIAL_HTTP_503");
    expect(posts).toBe(1);
    expect(await processTrialQueue(s)).toEqual({
      state: "READY",
      phase: "AVAILABILITY",
    });
    expect(posts).toBe(1);
    expect(remote.status).toBe("cancelled");
    expect(s.orderRpc.mock.calls.at(-1)[1].snapshot.order_id).toBe(901);
  });
  for (const [err, expected] of [
    [new DOMException("timeout", "TimeoutError"), "WORKER_NETWORK_TIMEOUT"],
    [new TypeError("fetch failed"), "WORKER_NETWORK_TIMEOUT"],
    [Error("TRIAL_CREATION_UNCERTAIN"), "TRIAL_CREATION_UNCERTAIN"],
    [Error("TRIAL_HTTP_409"), "TRIAL_HTTP_409"],
    [Error("raw response"), "WORKER_REVIEW_REQUIRED"],
  ]) {
    it(`sanitizes ${expected}`, () => expect(workerError(err)).toBe(expected));
  }
});
