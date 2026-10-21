// Offline protocol only. No network, credentials, database client or HTTP route.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const WOO_PILOT_ORIGIN =
  "https://salmon-nightingale-251188.hostingersite.com";
export const WOO_STAGING_PROJECT = "zsezjtswqeijboezvado";
const fail = (message) => {
  throw Error(message);
};
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");

export function verifyWooOrderHint(raw, signature, config) {
  if (
    config?.project !== WOO_STAGING_PROJECT ||
    config?.origin !== WOO_PILOT_ORIGIN
  )
    fail("WOO_TEST_DESTINATION_REQUIRED");
  if (
    typeof config.secret !== "string" ||
    Buffer.byteLength(config.secret) < 32
  )
    fail("WOO_SIGNING_SECRET_REQUIRED");
  if (!Buffer.isBuffer(raw) || !raw.length || raw.length > 262144)
    fail("WOO_BODY_SIZE_INVALID");
  // Canonical base64 only: Buffer.from alone accepts malformed/truncated input.
  if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(signature))
    fail("WOO_SIGNATURE_INVALID");
  const received = Buffer.from(signature, "base64");
  const expected = createHmac("sha256", config.secret).update(raw).digest();
  if (
    received.toString("base64") !== signature ||
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    fail("WOO_SIGNATURE_INVALID");
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    fail("WOO_BODY_INVALID");
  }
  if (!body || Array.isArray(body) || !positive(body.id))
    fail("WOO_ORDER_ID_INVALID");
  // Do not return customer PII, monetary fields or a proposed stock command.
  // Header delivery/topic/source values are not signed: never use them to route.
  return Object.freeze({
    protocol: "m9-woo-hint-1",
    origin: config.origin,
    order_id: body.id,
    payload_sha256: createHash("sha256").update(raw).digest("hex"),
    requires_authenticated_read: true,
  });
}

export function validateWooStockCommand(packet) {
  if (
    !exactKeys(packet, [
      "store_origin",
      "order_id",
      "operation_id",
      "expected_version",
      "action",
      "evidence_sha256",
      "reason",
      "lines",
    ]) ||
    packet.store_origin !== WOO_PILOT_ORIGIN ||
    !positive(packet.order_id) ||
    typeof packet.operation_id !== "string" ||
    !/^[A-Za-z0-9:_-]{1,120}$/.test(packet.operation_id) ||
    !Number.isSafeInteger(packet.expected_version) ||
    packet.expected_version < 0 ||
    packet.expected_version > 999999999999999 ||
    !["RESERVE", "CONSUME", "RELEASE", "RESTOCK"].includes(packet.action) ||
    typeof packet.evidence_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(packet.evidence_sha256) ||
    typeof packet.reason !== "string" ||
    !packet.reason.trim() ||
    packet.reason.length > 500 ||
    !Array.isArray(packet.lines) ||
    !packet.lines.length ||
    packet.lines.length > 50
  )
    fail("WOO_COMMAND_INVALID");
  const seen = new Set();
  const identities = new Set();
  for (const line of packet.lines) {
    if (
      !exactKeys(line, [
        "line_id",
        "product_id",
        "variation_id",
        "barcode",
        "quantity",
      ]) ||
      !positive(line.line_id) ||
      !positive(line.product_id) ||
      !Number.isSafeInteger(line.variation_id) ||
      line.variation_id < 0 ||
      typeof line.barcode !== "string" ||
      !line.barcode.length ||
      line.barcode.length > 160 ||
      line.barcode !== line.barcode.trim() ||
      !positive(line.quantity) ||
      line.quantity > 999999999 ||
      seen.has(line.line_id) ||
      identities.has(`${line.product_id}/${line.variation_id}`)
    )
      fail("WOO_LINE_INVALID");
    seen.add(line.line_id);
    identities.add(`${line.product_id}/${line.variation_id}`);
  }
  // A JSON round-trip also prevents references to caller-owned mutable objects.
  return JSON.parse(
    JSON.stringify({
      ...packet,
      lines: [...packet.lines].sort((a, b) => a.line_id - b.line_id),
    }),
  );
}
