import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  WOO_PILOT_ORIGIN,
  WOO_STAGING_PROJECT,
  verifyWooOrderHint,
  validateWooStockCommand,
} from "../../scripts/m9/woo-order-protocol.mjs";

const config = {
  origin: WOO_PILOT_ORIGIN,
  project: WOO_STAGING_PROJECT,
  secret: "synthetic-unit-test-key-not-a-real-credential",
};
const signed = (body) =>
  createHmac("sha256", config.secret).update(body).digest("base64");
const command = () => ({
  store_origin: WOO_PILOT_ORIGIN,
  order_id: 401,
  operation_id: "reserve:401",
  expected_version: 0,
  action: "RESERVE",
  evidence_sha256: "b".repeat(64),
  reason: "Synthetic unit test",
  lines: [
    {
      line_id: 2,
      product_id: 111,
      variation_id: 201,
      barcode: "000007779",
      quantity: 2,
    },
    {
      line_id: 1,
      product_id: 111,
      variation_id: 202,
      barcode: "236",
      quantity: 1,
    },
  ],
});

describe("Woo signed hints do not authorize stock", () => {
  it("verifies the exact raw bytes, discards PII, returns only a read hint", () => {
    const body = Buffer.from(
      '{ "id": 401, "billing": {"email":"private@example.invalid"}, "status":"processing" }',
    );
    const hint = verifyWooOrderHint(body, signed(body), config);
    expect(hint).toEqual({
      protocol: "m9-woo-hint-1",
      origin: WOO_PILOT_ORIGIN,
      order_id: 401,
      payload_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      requires_authenticated_read: true,
    });
    expect(Object.isFrozen(hint)).toBe(true);
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(body)));
    expect(() =>
      verifyWooOrderHint(reserialized, signed(body), config),
    ).toThrow("SIGNATURE");
  });
  for (const signature of [
    null,
    "",
    "x",
    "a".repeat(44),
    "A".repeat(43) + "=",
    "\n" + "A".repeat(43) + "=",
  ]) {
    it(`rejects malformed or incorrect signature ${String(signature).slice(0, 8)}`, () => {
      expect(() =>
        verifyWooOrderHint(Buffer.from('{"id":401}'), signature, config),
      ).toThrow("SIGNATURE");
    });
  }
  for (const body of [
    Buffer.from("{broken"),
    Buffer.from([0xff]),
    Buffer.from("[]"),
    Buffer.from('{"id":"401"}'),
    Buffer.from('{"id":0}'),
    Buffer.from('{"id":9007199254740992}'),
  ]) {
    it(`rejects invalid signed body ${body.toString().slice(0, 20)}`, () => {
      expect(() => verifyWooOrderHint(body, signed(body), config)).toThrow();
    });
  }
  it("bounds size before parsing, requires bytes and a separate strong test key", () => {
    for (const body of [Buffer.alloc(0), Buffer.alloc(262145), '{"id":401}'])
      expect(() => verifyWooOrderHint(body, "", config)).toThrow("BODY_SIZE");
    expect(() =>
      verifyWooOrderHint(Buffer.from("{}"), "", { ...config, secret: "short" }),
    ).toThrow("SECRET");
  });
  it("cannot select a production store/project", () => {
    const raw = Buffer.from('{"id":401}');
    for (const bad of [
      { ...config, origin: "https://vaquerosm.com" },
      { ...config, project: "drubkjlmfbdeglucakmg" },
    ])
      expect(() => verifyWooOrderHint(raw, signed(raw), bad)).toThrow(
        "DESTINATION",
      );
  });
  it("has no freshness claim: identical valid payloads yield identical hints", () => {
    const raw = Buffer.from('{"id":401}');
    expect(verifyWooOrderHint(raw, signed(raw), config)).toEqual(
      verifyWooOrderHint(raw, signed(raw), config),
    );
  });
});

describe("explicit stock commands", () => {
  it("preserves literal codes, sorts lines and detaches from input", () => {
    const original = command();
    const packet = validateWooStockCommand(original);
    expect(packet.lines.map((l) => l.line_id)).toEqual([1, 2]);
    expect(packet.lines[1].barcode).toBe("000007779");
    packet.lines[1].barcode = "new";
    expect(original.lines[0].barcode).toBe("000007779");
    expect(() =>
      validateWooStockCommand({
        ...original,
        expected_version: 1000000000000000,
      }),
    ).toThrow("COMMAND");
    expect(
      validateWooStockCommand({
        ...original,
        expected_version: 999999999999999,
      }).expected_version,
    ).toBe(999999999999999);
  });
  for (const action of ["RESERVE", "CONSUME", "RELEASE", "RESTOCK"])
    it(`accepts explicit ${action} without deriving a financial effect`, () => {
      expect(validateWooStockCommand({ ...command(), action }).action).toBe(
        action,
      );
    });
  const invalid = [
    (p) => {
      p.lines[0].barcode = 7779;
    },
    (p) => {
      p.lines[0].barcode = " 236";
    },
    (p) => {
      p.lines[0].quantity = 0;
    },
    (p) => {
      p.lines[0].quantity = 1.5;
    },
    (p) => {
      p.lines[0].quantity = 1000000000;
    },
    (p) => {
      p.lines[0].line_id = p.lines[1].line_id;
    },
    (p) => {
      p.lines[0].variation_id = p.lines[1].variation_id;
    },
    (p) => {
      p.lines[0].stock_quantity = 100;
    },
    (p) => {
      p.lines[0].product_id = Number.MAX_SAFE_INTEGER + 1;
    },
    (p) => {
      p.expected_version = -1;
    },
    (p) => {
      p.action = "refunded";
    },
    (p) => {
      p.order_id = "401";
    },
    (p) => {
      p.reason = "";
    },
    (p) => {
      p.operation_id = "";
    },
    (p) => {
      p.evidence_sha256 = "";
    },
    (p) => {
      p.store_origin = "https://vaquerosm.com";
    },
    (p) => {
      p.lines = [];
    },
    (p) => {
      p.lines = Array(51).fill(p.lines[0]);
    },
    (p) => {
      p.cost_cents = 0;
    },
  ];
  invalid.forEach((mutate, i) =>
    it(`blocks unsafe command ${i + 1}`, () => {
      const packet = command();
      mutate(packet);
      expect(() => validateWooStockCommand(packet)).toThrow();
    }),
  );
});
