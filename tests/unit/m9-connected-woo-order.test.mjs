import { describe, it, expect } from "vitest";
import { TEST_ORIGIN } from "../../scripts/m9/woo-remote/client.mjs";
import {
  ORDER_TRIAL_PROTOCOL,
  phaseOperationId,
  remoteOrderTrialClient,
  processConnectedWooTrial,
  validateOrderTrialSnapshot,
} from "../../scripts/m9/woo-remote/order-trial-client.mjs";
const id = "11111111-1111-4111-8111-111111111111",
  actorId = "22222222-2222-4222-8222-222222222222";
const parentId = "97c82026-b3cc-4c60-8f22-13d7c00fb33a";
const expected = {
  parent_id: parentId,
  owner: 2,
  variant_id: "6a73351b-91d3-49d5-8064-0a052ccbf851",
  barcode: "10582",
  quantity: 2,
  woo_product_id: 25,
  woo_variation_id: 27,
  unit_price_cents: 82000,
};
function snapshot(version = 1) {
  return {
    ...expected,
    protocol: ORDER_TRIAL_PROTOCOL,
    origin: TEST_ORIGIN,
    trial_id: id,
    order_id: 101,
    line_id: 201,
    version,
    status: ["pending", "processing", "cancelled"][version - 1],
    steps: ["CREATE", "PROCESS", "CANCEL"]
      .slice(0, version)
      .map((phase, i) => ({
        phase,
        status: ["pending", "processing", "cancelled"][i],
        version: i + 1,
      })),
    synthetic: true,
    payment_executed: false,
    shipping_executed: false,
  };
}
function fixture(config = {}) {
  let remote = null,
    claimed = false;
  const calls = [];
  const rpc = async (action, input) => {
    calls.push([action, input]);
    if (action === "INIT") {
      const dispatch = !claimed;
      claimed = true;
      return {
        state: config.verified ? "VERIFIED" : "DISPATCHING",
        dispatch,
        expected,
        result: { order_id: 101 },
        packet: {
          protocol: ORDER_TRIAL_PROTOCOL,
          trial_id: id,
          parent_id: parentId,
          barcode: expected.barcode,
          quantity: 2,
        },
      };
    }
    expect(input.snapshot.status).toBe("cancelled");
    return { order_id: 101, local_stock_persisted: false };
  };
  const client = {
    async preflight() {
      calls.push(["PREFLIGHT"]);
    },
    async read() {
      calls.push(["GET"]);
      return remote ? structuredClone(remote) : null;
    },
    async create() {
      calls.push(["POST_CREATE"]);
      if (config.createBefore) throw Error("TIMEOUT");
      remote = snapshot();
      if (config.createAfter) throw Error("TIMEOUT");
    },
    async step(_id, phase, version) {
      calls.push(["POST_STEP", phase]);
      if (config.stepBefore) throw Error("TIMEOUT");
      remote = snapshot(version + 1);
      if (config.changedOrder) remote.order_id = 102;
      if (config.stepAfter) throw Error("TIMEOUT");
    },
  };
  return {
    calls,
    run: () => processConnectedWooTrial({ id, parentId, actorId, rpc, client }),
  };
}
describe("durable connected Woo trial", () => {
  it("creates one order, reads its journal and sends only the verified result", async () => {
    const f = fixture();
    await expect(f.run()).resolves.toMatchObject({
      order_id: 101,
      local_stock_persisted: false,
    });
    expect(f.calls.filter((x) => x[0] === "POST_CREATE")).toHaveLength(1);
    expect(
      f.calls.filter((x) => x[0] === "POST_STEP").map((x) => x[1]),
    ).toEqual(["PROCESS", "CANCEL"]);
    expect(f.calls.filter((x) => x[0] === "FINISH")).toHaveLength(1);
  });
  for (const config of [{ createAfter: true }, { stepAfter: true }])
    it(`recovers committed results after timeout ${JSON.stringify(config)}`, async () => {
      const f = fixture(config);
      await f.run();
      expect(f.calls.filter((x) => x[0] === "POST_CREATE")).toHaveLength(1);
    });
  it("does not repeat an uncertain creation, including the next worker invocation", async () => {
    const f = fixture({ createBefore: true });
    await expect(f.run()).rejects.toThrow("CREATION_UNCERTAIN");
    await expect(f.run()).rejects.toThrow("CREATION_UNCERTAIN");
    expect(f.calls.filter((x) => x[0] === "POST_CREATE")).toHaveLength(1);
    expect(f.calls.some((x) => x[0] === "FINISH")).toBe(false);
  });
  it("holds an uncertain step instead of guessing a success", async () => {
    const f = fixture({ stepBefore: true });
    await expect(f.run()).rejects.toThrow("STEP_UNCERTAIN");
    expect(f.calls.filter((x) => x[0] === "POST_STEP")).toHaveLength(1);
    expect(f.calls.some((x) => x[0] === "FINISH")).toBe(false);
  });
  it("rejects another native order appearing in the same workflow", async () => {
    await expect(fixture({ changedOrder: true }).run()).rejects.toThrow(
      "STEP_UNCERTAIN",
    );
  });
  it("reuses a verified local receipt without another order or transition", async () => {
    const f = fixture({ verified: true });
    await expect(f.run()).resolves.toMatchObject({ replayed: true });
    expect(f.calls.map((x) => x[0])).toEqual(["PREFLIGHT", "INIT"]);
  });
  it("gives each step one stable UUID scoped to its trial", () => {
    expect(phaseOperationId(id, "PROCESS")).toBe(
      phaseOperationId(id, "PROCESS"),
    );
    expect(phaseOperationId(id, "PROCESS")).not.toBe(
      phaseOperationId(id, "CANCEL"),
    );
    expect(() => phaseOperationId(id, "REFUND")).toThrow();
  });
  for (const [key, value] of [
    ["origin", "https://vaquerosm.com"],
    ["barcode", 10582],
    ["barcode", "010582"],
    ["owner", 9],
    ["unit_price_cents", 0],
    ["quantity", 3],
    ["woo_variation_id", 38],
    ["variant_id", "another"],
    ["payment_executed", true],
    ["shipping_executed", true],
    ["synthetic", false],
    ["order_id", 0],
    ["line_id", -1],
    ["steps", []],
    ["status", "processing"],
  ])
    it(`rejects altered source field ${key}/${value}`, () => {
      expect(() =>
        validateOrderTrialSnapshot(
          { ...snapshot(3), [key]: value },
          expected,
          id,
        ),
      ).toThrow();
    });
});
describe("bounded remote order client", () => {
  const isolated = {
    origin: TEST_ORIGIN,
    order_trial_protocol: ORDER_TRIAL_PROTOCOL,
    mail_blocked: true,
    outbound_blocked: true,
    purchase_blocked: true,
    orders_blocked: true,
    payment_gateways: 0,
  };
  const make = (transport) =>
    remoteOrderTrialClient({
      origin: TEST_ORIGIN,
      username: "synthetic-user",
      password: "synthetic-fixture-only",
      transport,
    });
  it("pins host, rejects redirects, sends credentials only to the scoped API", async () => {
    const calls = [];
    const c = make(async (url, options) => {
      calls.push({ url, options });
      return Response.json(isolated);
    });
    await c.preflight();
    expect(calls[0].url).toBe(TEST_ORIGIN + "/wp-json/m9-test/v1/isolation");
    expect(calls[0].options.redirect).toBe("error");
    expect(calls[0].options.cache).toBe("no-store");
    expect(() =>
      remoteOrderTrialClient({
        origin: "https://vaquerosm.com",
        username: "u",
        password: "x",
      }),
    ).toThrow("ORIGIN");
  });
  it("requires all isolation controls and the dedicated protocol", async () => {
    for (const key of [
      "mail_blocked",
      "outbound_blocked",
      "purchase_blocked",
      "orders_blocked",
    ])
      await expect(
        make(async () =>
          Response.json({ ...isolated, [key]: false }),
        ).preflight(),
      ).rejects.toThrow("ISOLATION");
    await expect(
      make(async () =>
        Response.json({ ...isolated, order_trial_protocol: null }),
      ).preflight(),
    ).rejects.toThrow("ISOLATION");
  });
  it("distinguishes missing receipt from refused or failed authentication", async () => {
    await expect(
      make(async () => new Response("", { status: 404 })).read(id),
    ).resolves.toBeNull();
    await expect(
      make(async () => new Response("", { status: 401 })).read(id),
    ).rejects.toThrow("HTTP_401");
  });
  it("rejects an oversized response", async () => {
    await expect(
      make(async () => new Response("x".repeat(65537))).read(id),
    ).rejects.toThrow("TOO_LARGE");
  });
  it("does not send arbitrary phases or IDs", async () => {
    const c = make(() => {
      throw Error("NETWORK_SHOULD_NOT_RUN");
    });
    expect(() => c.read("bad")).toThrow("ID_INVALID");
    expect(() => c.step(id, "REFUND", 1)).toThrow("STEP_INVALID");
    expect(() => c.step(id, "PROCESS", 2)).toThrow("STEP_INVALID");
  });
});
