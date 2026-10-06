import { createHash } from "node:crypto";

export const TEST_ORIGIN =
  "https://salmon-nightingale-251188.hostingersite.com";
export const PROTOCOL = "m9-remote-draft-1";
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function requireValue(ok, code) {
  if (!ok) throw new Error(code);
}

// A separate client: the existing localhost worker retains its restrictions.
export function remoteClient({
  origin,
  username,
  password,
  transport = fetch,
}) {
  requireValue(origin === TEST_ORIGIN, "REMOTE_TEST_ORIGIN_REQUIRED");
  requireValue(
    typeof username === "string" &&
      username.length > 0 &&
      !username.includes(":") &&
      typeof password === "string" &&
      password.length > 0,
    "SCOPED_CREDENTIAL_REQUIRED",
  );
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  async function call(method, path, payload) {
    requireValue(
      (method === "GET" &&
        (path === "isolation" ||
          /^(receipts|galleries|gallery-updates)\/[0-9a-f-]{36}$/i.test(path) ||
          /^photos\/[0-9a-f-]{36}\/[1-9][0-9]*$/i.test(path))) ||
        (method === "POST" && ["drafts", "gallery-updates"].includes(path)),
      "REMOTE_OPERATION_FORBIDDEN",
    );
    const response = await transport(`${origin}/wp-json/m9-test/v1/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    requireValue(response.ok, `REMOTE_HTTP_${response.status}`);
    return response.json();
  }
  async function preflight() {
    const state = await call("GET", "isolation");
    requireValue(
      state.protocol === PROTOCOL &&
        state.origin === origin &&
        state.mail_blocked === true &&
        state.outbound_blocked === true &&
        state.purchase_blocked === true &&
        state.orders_blocked === true &&
        state.payment_gateways === 0,
      "REMOTE_ISOLATION_REQUIRED",
    );
    return state;
  }
  return {
    preflight,
    photo: async (id, mediaId) => {
      requireValue(
        uuid.test(id) && Number.isSafeInteger(mediaId) && mediaId > 0,
        "INVALID_PHOTO_ID",
      );
      const photo = await call("GET", `photos/${id}/${mediaId}`);
      requireValue(
        typeof photo.base64 === "string" && photo.base64.length <= 5592408,
        "INVALID_IMAGE",
      );
      const bytes = Buffer.from(photo.base64, "base64");
      requireValue(
        bytes.length > 0 &&
          bytes.length <= 4194304 &&
          bytes.toString("base64") === photo.base64 &&
          createHash("sha256").update(bytes).digest("hex") === photo.sha256,
        "INVALID_IMAGE_HASH_OR_SIZE",
      );
      return photo;
    },
    galleryUpdateReceipt: (id) => {
      requireValue(uuid.test(id), "INVALID_REQUEST_ID");
      return call("GET", `gallery-updates/${id}`);
    },
    updateGallery: async (packet) => {
      requireValue(
        uuid.test(packet.update_id) && uuid.test(packet.parent_id),
        "INVALID_REQUEST_ID",
      );
      await preflight();
      return call("POST", "gallery-updates", packet);
    },
    gallery: (id) => {
      requireValue(uuid.test(id), "INVALID_REQUEST_ID");
      return call("GET", `galleries/${id}`);
    },
    receipt: (id) => {
      requireValue(uuid.test(id), "INVALID_REQUEST_ID");
      return call("GET", `receipts/${id}`);
    },
    createDraft: async (packet) => {
      validatePacket(packet);
      await preflight();
      // No automatic retry: query the receipt after a timeout/unknown outcome.
      return call("POST", "drafts", packet);
    },
  };
}

export function validatePacket(p) {
  const keys = [
    "protocol",
    "request_id",
    "product_id",
    "revision",
    "name",
    "description",
    "short_description",
    "barcode",
    "price_cents",
    "image",
  ];
  requireValue(
    p &&
      Object.keys(p).length === keys.length &&
      Object.keys(p).every((k) => keys.includes(k)),
    "INVALID_PACKET_FIELDS",
  );
  requireValue(
    p.protocol === PROTOCOL &&
      uuid.test(p.request_id) &&
      uuid.test(p.product_id),
    "INVALID_PACKET_IDENTITY",
  );
  requireValue(
    Number.isSafeInteger(p.revision) && p.revision > 0,
    "INVALID_REVISION",
  );
  for (const [key, limit] of [
    ["name", 200],
    ["description", 20000],
    ["short_description", 2000],
    ["barcode", 100],
  ]) {
    requireValue(
      typeof p[key] === "string" &&
        p[key].trim().length > 0 &&
        p[key].length <= limit &&
        !Array.from(p[key]).some(
          (c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)),
        ),
      "INVALID_TEXT",
    );
  }
  requireValue(p.barcode === p.barcode.trim(), "BARCODE_MUST_BE_LITERAL");
  requireValue(
    Number.isSafeInteger(p.price_cents) &&
      p.price_cents >= 0 &&
      p.price_cents <= 100000000,
    "INVALID_PRICE",
  );
  requireValue(
    p.image &&
      Object.keys(p.image).sort().join(",") === "base64,sha256" &&
      typeof p.image.base64 === "string" &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(p.image.base64),
    "INVALID_IMAGE",
  );
  const bytes = Buffer.from(p.image.base64, "base64");
  requireValue(
    bytes.length > 0 &&
      bytes.length <= 4 * 1024 * 1024 &&
      bytes.toString("base64") === p.image.base64 &&
      createHash("sha256").update(bytes).digest("hex") === p.image.sha256,
    "INVALID_IMAGE_HASH_OR_SIZE",
  );
  return p;
}
