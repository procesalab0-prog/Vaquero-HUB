// Standalone local rehearsal. Synthetic internal IDs/SKUs; real source barcodes.
// This does not load the family into staging or authorize a production import.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { hash, assert, localStore, compilePlan } from "./plan.mjs";
import { wooClient, runJob } from "./worker.mjs";
import { sourceImage, imageType } from "./staging-bridge.mjs";
const [lotPath, runtimePath, outPath] = process.argv.slice(2);
assert(
  lotPath && runtimePath && outPath,
  "Usage: rehearse-family.mjs CANDIDATE_LOT RUNTIME NEW_OUTPUT_DIR",
);
const source = JSON.parse(await readFile(resolve(lotPath), "utf8"));
const p = source.products.find((x) => x.woo_product_id === 5630);
assert(
  source.version === "m9-candidate-review-1" &&
    p?.type === "variable" &&
    p.variants.length === 5 &&
    p.variants.every(
      (v) => v.proposed_price_change === null && !v.sale_price_woo,
    ) &&
    p.variants.map((v) => v.barcode).join(",") ===
      "10581,10582,10583,10584,10585",
  "FAMILY_SOURCE_REVIEW_REQUIRED",
);
const root = resolve(runtimePath),
  out = resolve(outPath);
const store = {
  id: "m9-local-2026-10-02",
  base_url: "http://127.0.0.1:9417",
  environment: "LOCAL_WOO_TEST",
};
const origin = localStore(store);
const uuid = (s) => {
  const h = hash(s);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const productId = uuid(["M9_LOCAL_FAMILY_REHEARSAL", p.woo_product_id]);
const journalDir = resolve(root, "private/worker-journal");
try {
  await access(resolve(journalDir, `${hash([store.id, productId])}.json`));
  throw new Error("FAMILY_ALREADY_REHEARSED_REVIEW_EXISTING_EVIDENCE");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await mkdir(out, { mode: 0o700 }); // Existing directory always requires operator review.
const save = (name, data) =>
  writeFile(resolve(out, name), JSON.stringify(data, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
await save("source.json", p);
const auth = JSON.parse(
  await readFile(resolve(root, "private/auth.json"), "utf8"),
);
const authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
async function call(path, method = "GET", body, headers = {}) {
  const url = `${origin}/wp-json/${path}`;
  const options = {
    method,
    redirect: method === "GET" ? "manual" : "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body
      ? { body: body instanceof Uint8Array ? body : JSON.stringify(body) }
      : {}),
  };
  let r = await fetch(url, options);
  if (
    method === "GET" &&
    r.status >= 300 &&
    r.status < 400 &&
    r.headers.get("location") &&
    new URL(r.headers.get("location"), url).href === url
  )
    r = await fetch(url, { ...options, redirect: "error" });
  assert(r.ok, `LOCAL_HTTP_${r.status}`);
  return r.json();
}
const isolation = await call("m9-local/v1/isolation");
assert(
  isolation.environment === "local" &&
    isolation.url === origin &&
    isolation.outbound_blocked &&
    isolation.mail_blocked &&
    isolation.cron_disabled &&
    !isolation.webhooks_enabled &&
    isolation.payment_gateways === 0 &&
    isolation.orders === 0,
  "ISOLATION_FAILED",
);
const category = await call("wc/v3/products/categories/16");
assert(category.name === "Laboratorio M9", "LAB_CATEGORY_CHANGED");
const input = {
  store,
  product_id: productId,
  revision: 1,
  mode: "create",
  type: "variable",
  content: {
    name: `ENSAYO — ${p.name}`,
    base_code: p.baseline.short_description,
    short_description: p.baseline.short_description,
    description: p.baseline.description,
    images: p.baseline.image_urls.map((url) => ({ url, alt: "" })),
    categories: ["Laboratorio M9"],
  },
  bindings: {
    store_id: store.id,
    categories: [{ id: category.id, path: "Laboratorio M9" }],
    images: p.baseline.image_urls.map((url, i) => ({ url, id: i + 1 })),
  },
  variants: p.variants.map((v) => ({
    id: uuid(["M9_LOCAL_VARIANT_REHEARSAL", v.barcode]),
    sku: `M9-LAB-${v.barcode}`,
    barcode: v.barcode,
    price_cents: Number(v.retail_sicar) * 100,
    attributes: v.attributes,
  })),
};
compilePlan(input);
for (const [i, img] of input.content.images.entries()) {
  const r = await fetch(sourceImage(img.url), {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  assert(r.ok, "IMAGE_READ_FAILED");
  const chunks = [];
  let size = 0;
  for await (const chunk of r.body) {
    size += chunk.length;
    assert(size <= 4 * 1024 * 1024, "IMAGE_TOO_LARGE");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const [mime, ext] = imageType(bytes);
  await save(`media-${i}-dispatch.json`, {
    source: img.url,
    bytes: size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const media = await call("wp/v2/media", "POST", bytes, {
    "Content-Type": mime,
    "Content-Disposition": `attachment; filename="m9-family-5630-${i}.${ext}"`,
  });
  await save(`media-${i}-result.json`, {
    id: media.id,
    source_url: media.source_url,
  });
  const check = await call(`wp/v2/media/${media.id}`);
  assert(
    check.id === media.id &&
      check.media_type === "image" &&
      check.source_url.startsWith(`${origin}/`),
    "MEDIA_VERIFY_FAILED",
  );
  input.bindings.images[i] = { id: media.id, url: img.url };
}
const request = wooClient(store, authorization);
await save("create-input.json", input);
const created = await runJob({ input, journalDir, request });
await save("create-result.json", created);
assert(created.state === "SUCCEEDED", "CREATE_REVIEW_REQUIRED");
const pid = created.steps[0].remote_id;
const parent = await request("GET", `products/${pid}`);
const children = await Promise.all(
  created.steps
    .slice(1)
    .map((s) => request("GET", `products/${pid}/variations/${s.remote_id}`)),
);
await save("created-parent.json", parent);
await save("created-variants.json", children);
const update = structuredClone(input);
update.mode = "update";
update.revision = 2;
update.content.description = update.content.description.replace(
  "AMARILLOEN",
  "AMARILLO EN",
);
update.variants = update.variants.slice(0, 1);
update.target = {
  store_id: store.id,
  product_id: pid,
  snapshot: parent,
  variants: [
    {
      variant_id: update.variants[0].id,
      id: children[0].id,
      snapshot: children[0],
    },
  ],
};
await save("update-input.json", update);
const updated = await runJob({ input: update, journalDir, request });
await save("update-result.json", updated);
assert(updated.state === "SUCCEEDED", "UPDATE_REVIEW_REQUIRED");
const finalChildren = await Promise.all(
  children.map((v) => request("GET", `products/${pid}/variations/${v.id}`)),
);
assert(
  finalChildren.slice(1).every((v, i) => hash(v) === hash(children[i + 1])),
  "OMITTED_VARIANT_CHANGED",
);
assert(
  finalChildren.every((v, i) =>
    v.meta_data.some(
      (m) =>
        m.key === "_mi_tienda_barcode" && m.value === p.variants[i].barcode,
    ),
  ),
  "BARCODE_CHANGED",
);
const finalParent = await request("GET", `products/${pid}`);
assert(
  finalParent.variations.length === 5 && finalParent.status === "draft",
  "FAMILY_CHANGED",
);
let calls = 0;
await runJob({
  input: update,
  journalDir,
  request: async (...a) => {
    calls++;
    return request(...a);
  },
});
assert(calls === 0, "REPEATED_WRITE");
const result = {
  kind: "LOCAL_FAMILY_REHEARSAL_NOT_STAGING_IMPORT",
  source_sha256: hash(p),
  woo_source_id: p.woo_product_id,
  local_product_id: pid,
  local_variant_ids: children.map((v) => v.id),
  barcodes: p.variants.map((v) => v.barcode),
  attributes: p.variants.map((v) => v.attributes),
  omitted_variants_unchanged: 4,
  repeat_requests: calls,
  production_writes: 0,
  inventory_payload_fields: 0,
  isolation,
};
await save("final-parent.json", finalParent);
await save("final-variants.json", finalChildren);
await save("verification.json", result);
console.log(JSON.stringify(result, null, 2));
