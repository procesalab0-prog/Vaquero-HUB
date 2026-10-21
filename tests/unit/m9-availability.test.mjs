import { describe, it, expect, vi } from "vitest";
import {
  processAvailability,
  validateAvailability,
} from "../../scripts/m9/woo-remote/process-availability.mjs";
import { remoteOrderTrialClient } from "../../scripts/m9/woo-remote/order-trial-client.mjs";
import { TEST_ORIGIN } from "../../scripts/m9/woo-remote/client.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const packet = {
  protocol: "m9-remote-availability-trial-1",
  trial_id: id,
  quantities: [3, 1, 0, 1, 1, 3],
};
const expected = { barcode: "01001", woo_product_id: 25, woo_variation_id: 27 };
const stock = {
  variation: {
    manage_stock: false,
    quantity: null,
    status: "outofstock",
    backorders: "no",
  },
  parent: {
    manage_stock: false,
    quantity: null,
    status: "instock",
    backorders: "no",
  },
};
function receipt() {
  return {
    ...packet,
    ...expected,
    origin: TEST_ORIGIN,
    synthetic: true,
    restored: true,
    before: structuredClone(stock),
    after: structuredClone(stock),
  };
}
function setup() {
  const c = {
    availabilityPreflight: vi.fn().mockResolvedValue({}),
    readAvailability: vi.fn().mockResolvedValue(receipt()),
    applyAvailability: vi.fn().mockResolvedValue(receipt()),
  };
  const rpc = vi
    .fn()
    .mockImplementation(async (action) =>
      action === "INIT"
        ? { state: "DISPATCHING", dispatch: true, packet, expected }
        : { verified: true },
    );
  return { id, actorId: "actor", client: c, rpc };
}
describe("scoped availability transport", () => {
  it("claims before dispatch, checks twice and records verified receipt", async () => {
    const s = setup();
    s.client.readAvailability.mockResolvedValueOnce(null);
    expect(await processAvailability(s)).toEqual(receipt());
    expect(s.rpc.mock.calls.map((x) => x[0])).toEqual(["INIT", "FINISH"]);
    expect(s.client.applyAvailability).toHaveBeenCalledExactlyOnceWith(packet);
    expect(s.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      s.client.applyAvailability.mock.invocationCallOrder[0],
    );
  });
  it("recovers an accepted POST through GET without repeating", async () => {
    const s = setup();
    s.client.readAvailability.mockResolvedValueOnce(null);
    s.client.applyAvailability.mockRejectedValueOnce(Error("timeout"));
    expect(await processAvailability(s)).toEqual(receipt());
    expect(s.client.applyAvailability).toHaveBeenCalledTimes(1);
  });
  it("never redispatches an existing uncertain claim", async () => {
    const s = setup();
    s.rpc.mockResolvedValueOnce({
      state: "DISPATCHING",
      dispatch: false,
      packet,
      expected,
    });
    s.client.readAvailability.mockResolvedValue(null);
    await expect(processAvailability(s)).rejects.toThrow(
      "AVAILABILITY_RECEIPT_CHANGED",
    );
    expect(s.client.applyAvailability).not.toHaveBeenCalled();
    expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not label a failed restoration successful", async () => {
    const s = setup();
    s.client.readAvailability.mockRejectedValue(Error("409_REVIEW"));
    await expect(processAvailability(s)).rejects.toThrow("409_REVIEW");
    expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it("verified replays never write again", async () => {
    const s = setup();
    s.rpc.mockResolvedValueOnce({
      state: "VERIFIED",
      receipt: receipt(),
      packet,
      expected,
    });
    expect(await processAvailability(s)).toEqual(receipt());
    expect(s.client.applyAvailability).not.toHaveBeenCalled();
    expect(s.client.readAvailability).not.toHaveBeenCalled();
  });
  for (const [field, value] of Object.entries({
    protocol: "other",
    origin: "https://vaquerosm.com",
    trial_id: "other",
    synthetic: false,
    restored: false,
    barcode: "1001",
    woo_product_id: 99,
    woo_variation_id: 99,
    quantities: [99],
    before: null,
    after: {},
  })) {
    it(`rejects changed ${field}`, () => {
      const r = receipt();
      r[field] = value;
      expect(() => validateAvailability(r, packet, expected)).toThrow(
        "AVAILABILITY_RECEIPT_CHANGED",
      );
    });
  }
  it("requires the remote original stock to be untracked and unset", () => {
    const r = receipt();
    r.before.variation.quantity = 2;
    r.after = structuredClone(r.before);
    expect(() => validateAvailability(r, packet, expected)).toThrow();
  });
  it("holds a changed second observation", async () => {
    const s = setup();
    const r = receipt();
    r.before.parent.status = "outofstock";
    r.after = structuredClone(r.before);
    s.client.readAvailability
      .mockResolvedValueOnce(receipt())
      .mockResolvedValueOnce(r);
    await expect(processAvailability(s)).rejects.toThrow(
      "AVAILABILITY_OBSERVATION_CHANGED",
    );
    expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it("fails closed before a claim if protocol is unavailable", async () => {
    const s = setup();
    s.client.availabilityPreflight.mockRejectedValue(Error("disabled"));
    await expect(processAvailability(s)).rejects.toThrow("disabled");
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("uses only the scoped destination and forbids redirects", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(receipt())));
    const c = remoteOrderTrialClient({
      origin: TEST_ORIGIN,
      username: "technical",
      password: "fixture",
      transport,
    });
    await c.applyAvailability(packet);
    expect(transport.mock.calls[0][0]).toBe(
      `${TEST_ORIGIN}/wp-json/m9-test/v1/availability-trials`,
    );
    expect(transport.mock.calls[0][1]).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
    });
  });
});
