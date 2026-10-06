import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  remoteClient,
  validatePacket,
  TEST_ORIGIN,
  PROTOCOL,
} from "../../scripts/m9/woo-remote/client.mjs";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const packet = () => ({
  protocol: PROTOCOL,
  request_id: "c8293124-c9e0-4af2-b197-9243bb3e9369",
  product_id: "c8293124-c9e0-4af2-b197-9243bb3e9370",
  revision: 1,
  name: "Prueba",
  description: "Descripción",
  short_description: "Código de prueba",
  barcode: "000123",
  price_cents: 219000,
  image: {
    base64: image.toString("base64"),
    sha256: createHash("sha256").update(image).digest("hex"),
  },
});
const state = {
  protocol: PROTOCOL,
  origin: TEST_ORIGIN,
  mail_blocked: true,
  outbound_blocked: true,
  purchase_blocked: true,
  orders_blocked: true,
  payment_gateways: 0,
};
const credentials = {
  origin: TEST_ORIGIN,
  username: "test-bridge",
  password: "test-only-placeholder",
};
describe("remote test bridge", () => {
  it.each([
    "https://vaquerosm.com",
    TEST_ORIGIN + "/",
    TEST_ORIGIN + ".evil.test",
    "http://127.0.0.1:9417",
  ])("rejects unapproved origin %s", (origin) => {
    expect(() => remoteClient({ ...credentials, origin })).toThrow(
      "REMOTE_TEST_ORIGIN_REQUIRED",
    );
  });
  it("preserves literal barcode and rejects inventory fields", () => {
    expect(validatePacket(packet()).barcode).toBe("000123");
    expect(() => validatePacket({ ...packet(), stock_quantity: 1 })).toThrow(
      "INVALID_PACKET_FIELDS",
    );
    expect(() => validatePacket({ ...packet(), barcode: 123 })).toThrow();
    expect(() => validatePacket({ ...packet(), barcode: " 000123" })).toThrow();
  });
  it("rejects corrupt image, nonintegral price and changed protocol", () => {
    const p = packet();
    p.image.sha256 = "0".repeat(64);
    expect(() => validatePacket(p)).toThrow("INVALID_IMAGE_HASH_OR_SIZE");
    expect(() => validatePacket({ ...packet(), price_cents: 1.1 })).toThrow();
    expect(() =>
      validatePacket({ ...packet(), protocol: "production" }),
    ).toThrow();
  });
  it.each([
    "mail_blocked",
    "outbound_blocked",
    "purchase_blocked",
    "orders_blocked",
  ])("fails closed without %s", async (field) => {
    const calls = [];
    const client = remoteClient({
      ...credentials,
      transport: async (...args) => {
        calls.push(args);
        return { ok: true, json: async () => ({ ...state, [field]: false }) };
      },
    });
    await expect(client.createDraft(packet())).rejects.toThrow(
      "REMOTE_ISOLATION_REQUIRED",
    );
    expect(calls).toHaveLength(1);
  });
  it("checks isolation before posting and never follows redirects", async () => {
    const calls = [];
    const client = remoteClient({
      ...credentials,
      transport: async (...args) => {
        calls.push(args);
        return {
          ok: true,
          json: async () =>
            calls.length === 1 ? state : { state: "SUCCEEDED" },
        };
      },
    });
    await client.createDraft(packet());
    expect(calls.map(([url, o]) => [url, o.method, o.redirect])).toEqual([
      [TEST_ORIGIN + "/wp-json/m9-test/v1/isolation", "GET", "error"],
      [TEST_ORIGIN + "/wp-json/m9-test/v1/drafts", "POST", "error"],
    ]);
  });
  it("does not retry uncertain writes or leak error bodies", async () => {
    let calls = 0;
    const client = remoteClient({
      ...credentials,
      transport: async () => {
        calls++;
        if (calls === 1) return { ok: true, json: async () => state };
        return {
          ok: false,
          status: 500,
          json: async () => {
            throw new Error("SECRET");
          },
        };
      },
    });
    await expect(client.createDraft(packet())).rejects.toThrow(
      "REMOTE_HTTP_500",
    );
    expect(calls).toBe(2);
  });
  it("rejects invalid receipt path without network access", async () => {
    const client = remoteClient({
      ...credentials,
      transport: () => {
        throw new Error("NETWORK");
      },
    });
    expect(() => client.receipt("../../orders")).toThrow("INVALID_REQUEST_ID");
  });
});
