import { createHash } from "node:crypto";

export const TEST_ORIGIN =
  "https://salmon-nightingale-251188.hostingersite.com";
export const FAMILY_PROTOCOL = "m9-remote-family-1";
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
          /^(receipts|galleries|gallery-updates|variant-photos|variant-photo-assignments)\/[0-9a-f-]{36}$/i.test(
            path,
          ) ||
          /^photos\/[0-9a-f-]{36}\/[1-9][0-9]*$/i.test(path))) ||
        (method === "POST" &&
          [
            "drafts",
            "families",
            "gallery-updates",
            "variant-photo-assignments",
          ].includes(path)),
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
    variantPhotoWritePreflight: async () => {
      const state = await preflight();
      requireValue(
        state.variant_photo_write_protocol ===
          "m9-remote-variant-photo-write-1",
        "VARIANT_PHOTO_WRITER_UNAVAILABLE",
      );
      return state;
    },
    assignVariantPhotos: async (packet) => {
      const { validateVariantPhotoPacket } =
        await import("./variant-photo-packet.mjs");
      validateVariantPhotoPacket(packet);
      const state = await preflight();
      requireValue(
        state.variant_photo_write_protocol ===
          "m9-remote-variant-photo-write-1",
        "VARIANT_PHOTO_WRITER_UNAVAILABLE",
      );
      return call("POST", "variant-photo-assignments", packet);
    },
    variantPhotoReceipt: async (id) => {
      requireValue(uuid.test(id), "INVALID_REQUEST_ID");
      await preflight();
      return call("GET", `variant-photo-assignments/${id}`);
    },
    variantPhotos: async (id) => {
      requireValue(
        [
          "97c82026-b3cc-4c60-8f22-13d7c00fb33a",
          "ba239bba-7691-43cc-9c76-8768a1af9f21",
        ].includes(id),
        "VARIANT_PHOTO_PILOT_REQUIRED",
      );
      await preflight();
      return call("GET", `variant-photos/${id}`);
    },
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
    createFamily: async (packet) => {
      validateFamilyPacket(packet);
      const state = await preflight();
      requireValue(
        state.family_protocol === FAMILY_PROTOCOL,
        "REMOTE_FAMILY_UNAVAILABLE",
      );
      return call("POST", "families", packet);
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

export function validateFamilyPacket(p) {
  const fields = [
    "protocol",
    "request_id",
    "product_id",
    "revision",
    "name",
    "description",
    "short_description",
    "barcode",
    "variants",
    "categories",
    "images",
    "descriptive_attributes",
  ];
  requireValue(
    p &&
      Object.keys(p).length === fields.length &&
      Object.keys(p).every((k) => fields.includes(k)),
    "INVALID_FAMILY_FIELDS",
  );
  requireValue(
    p.protocol === FAMILY_PROTOCOL && p.barcode === `M9-P-${p.product_id}`,
    "INVALID_FAMILY_IDENTITY",
  );
  requireValue(
    Array.isArray(p.variants) &&
      p.variants.length >= 2 &&
      p.variants.length <= 100,
    "INVALID_FAMILY_VARIANTS",
  );
  requireValue(
    Array.isArray(p.images) && p.images.length >= 1 && p.images.length <= 20,
    "INVALID_FAMILY_IMAGES",
  );
  let total = 0;
  for (const image of p.images) {
    requireValue(
      Object.keys(image).sort().join(",") === "alt,base64,sha256" &&
        typeof image.alt === "string" &&
        image.alt.length <= 240,
      "INVALID_FAMILY_IMAGE",
    );
    validatePacket({
      protocol: PROTOCOL,
      request_id: p.request_id,
      product_id: p.product_id,
      revision: p.revision,
      name: p.name,
      description: p.description,
      short_description: p.short_description,
      barcode: p.barcode,
      price_cents: 0,
      image: { base64: image.base64, sha256: image.sha256 },
    });
    total += Buffer.from(image.base64, "base64").length;
  }
  requireValue(
    total <= 16777216 &&
      new Set(p.images.map((i) => i.sha256)).size === p.images.length,
    "FAMILY_IMAGE_LIMIT_OR_DUPLICATE",
  );
  const ids = new Set(),
    codes = new Set(),
    combinations = new Set();
  let keys = null;
  for (const v of p.variants) {
    requireValue(
      Object.keys(v).sort().join(",") ===
        "attributes,barcode,price_cents,variant_id" && uuid.test(v.variant_id),
      "INVALID_FAMILY_VARIANT",
    );
    requireValue(
      typeof v.barcode === "string" &&
        v.barcode === v.barcode.trim() &&
        v.barcode.length > 0 &&
        v.barcode.length <= 100 &&
        v.barcode !== p.barcode,
      "INVALID_FAMILY_BARCODE",
    );
    requireValue(
      Number.isSafeInteger(v.price_cents) &&
        v.price_cents >= 0 &&
        v.price_cents <= 100000000,
      "INVALID_PRICE",
    );
    requireValue(
      v.attributes &&
        !Array.isArray(v.attributes) &&
        Object.keys(v.attributes).length >= 1 &&
        Object.keys(v.attributes).length <= 3,
      "INVALID_FAMILY_ATTRIBUTES",
    );
    const entries = Object.entries(v.attributes).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    requireValue(
      entries.every(
        ([k, val]) =>
          ["TALLA", "COLOR", "LARGO"].includes(k) &&
          typeof val === "string" &&
          val.length > 0 &&
          val.length <= 100 &&
          val === val.trim(),
      ),
      "INVALID_FAMILY_ATTRIBUTES",
    );
    const shape = JSON.stringify(entries.map(([k]) => k)),
      combination = JSON.stringify(entries);
    requireValue(
      keys === null || shape === keys,
      "FAMILY_ATTRIBUTE_KEYS_DIFFER",
    );
    keys = shape;
    requireValue(
      !ids.has(v.variant_id) &&
        !codes.has(v.barcode) &&
        !combinations.has(combination),
      "FAMILY_DUPLICATE_IDENTITY",
    );
    ids.add(v.variant_id);
    codes.add(v.barcode);
    combinations.add(combination);
  }
  requireValue(
    Array.isArray(p.categories) &&
      p.categories.length <= 20 &&
      new Set(p.categories).size === p.categories.length &&
      p.categories.every(
        (c) =>
          typeof c === "string" &&
          c.length <= 240 &&
          c.split(" > ").every((n) => n.length > 0 && n === n.trim()),
      ),
    "INVALID_FAMILY_CATEGORIES",
  );
  requireValue(
    Array.isArray(p.descriptive_attributes) &&
      p.descriptive_attributes.length <= 10 &&
      p.descriptive_attributes.every(
        (a) =>
          Object.keys(a).sort().join(",") === "name,option,variation" &&
          a.variation === false &&
          typeof a.name === "string" &&
          a.name.length > 0 &&
          typeof a.option === "string" &&
          a.option.length > 0,
      ),
    "INVALID_DESCRIPTIVE_ATTRIBUTES",
  );
  return p;
}
