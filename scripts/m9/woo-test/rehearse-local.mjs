import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sampleInput } from "./fixtures.mjs";
import { assert, hash, localStore, VERSION } from "./plan.mjs";
import { runJob, wooClient } from "./worker.mjs";

const [runtimeArg, outputArg, resumeInput] = process.argv.slice(2);
assert(
  runtimeArg && outputArg,
  "Usage: rehearse-local.mjs RUNTIME_DIR NEW_OUTPUT_DIR",
);
const root = resolve(runtimeArg),
  out = resolve(outputArg);
// Refuse to reuse an evidence directory: failed runs need inspection, not reset.
await mkdir(out, { mode: 0o700 });
const input = resumeInput
    ? JSON.parse(await readFile(resolve(resumeInput), "utf8"))
    : sampleInput(),
  origin = localStore(input.store);
const auth = JSON.parse(
  await readFile(resolve(root, "private/auth.json"), "utf8"),
);
const authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
const headers = {
  Authorization: authorization,
  "Content-Type": "application/json",
};
async function call(path, method = "GET", body, extra = {}) {
  const url = `${origin}/wp-json/${path}`;
  const options = {
    method,
    headers: { ...headers, ...extra },
    redirect: method === "GET" ? "manual" : "error",
    signal: AbortSignal.timeout(30000),
    ...(body
      ? {
          body:
            typeof body === "string" || body instanceof Uint8Array
              ? body
              : JSON.stringify(body),
        }
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
  assert(r.ok, `LOCAL_SETUP_HTTP_${r.status}`);
  return r.json();
}
const isolation = await call("m9-local/v1/isolation");
assert(
  isolation.environment === "local" &&
    isolation.url === origin &&
    isolation.cron_disabled &&
    isolation.outbound_blocked &&
    isolation.mail_blocked &&
    isolation.payment_gateways === 0 &&
    !isolation.webhooks_enabled &&
    isolation.orders === 0,
  "ISOLATION_FAILED",
);
if (!resumeInput) {
  const before = await call("wc/v3/products?per_page=100&status=any");
  assert(before.length === 0, "REHEARSAL_REQUIRES_EMPTY_LOCAL_CATALOG");
  const category = await call("wc/v3/products/categories", "POST", {
    name: "Laboratorio M9",
    slug: "laboratorio-m9",
  });
  const image = await call(
    "wp/v2/media",
    "POST",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
    {
      "Content-Type": "image/png",
      "Content-Disposition": 'attachment; filename="m9-fixture.png"',
    },
  );
  input.content.images[0].url = image.source_url;
  input.bindings.images[0] = { id: image.id, url: image.source_url };
  input.bindings.categories[0].id = category.id;
}
const journalDir = resolve(root, "private/worker-journal");
const request = wooClient(input.store, authorization);
const save = (name, value) =>
  writeFile(resolve(out, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
await save("create-input.json", input);
const created = await runJob({ input, journalDir, request });
await save("create-result.json", created);
assert(created.state === "SUCCEEDED", "CREATE_NOT_VERIFIED_SEE_JOURNAL");
let repeatCalls = 0;
const repeated = await runJob({
  input,
  journalDir,
  request: async (...args) => {
    repeatCalls++;
    return request(...args);
  },
});
assert(
  repeatCalls === 0 && hash(created) === hash(repeated),
  "DUPLICATED_CREATE",
);
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
update.content.name = "PRUEBA M9 — Camisa actualizada desde el programa";
update.content.description =
  "Esta ficha se creó y después se actualizó mediante la API de WooCommerce.\nSólo la talla M cambió de precio; XL se conserva.";
update.variants = update.variants.slice(0, 1);
update.variants[0].price_cents = 82500;
update.target = {
  store_id: input.store.id,
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
assert(updated.state === "SUCCEEDED", "UPDATE_NOT_VERIFIED_SEE_JOURNAL");
let updateRepeatCalls = 0;
await runJob({
  input: update,
  journalDir,
  request: async (...args) => {
    updateRepeatCalls++;
    return request(...args);
  },
});
assert(updateRepeatCalls === 0, "DUPLICATED_UPDATE");
const untouched = await request(
  "GET",
  `products/${pid}/variations/${children[1].id}`,
);
assert(hash(untouched) === hash(children[1]), "OMITTED_VARIANT_CHANGED");
const finalParent = await request("GET", `products/${pid}`),
  finalFirst = await request(
    "GET",
    `products/${pid}/variations/${children[0].id}`,
  );
assert(
  finalParent.status === "draft" &&
    finalParent.variations.length === 2 &&
    finalFirst.meta_data.some(
      (m) => m.key === "_mi_tienda_barcode" && m.value === "000007779",
    ),
  "IDENTITY_OR_STATUS_CHANGED",
);
const afterIsolation = await call("m9-local/v1/isolation");
assert(afterIsolation.orders === 0, "UNEXPECTED_ORDER");
const evidence = {
  version: VERSION,
  kind: "REAL_LOCAL_WOOCOMMERCE_API_NOT_APP_UI",
  isolation,
  create: created.state,
  update: updated.state,
  product_id: pid,
  variant_ids: children.map((v) => v.id),
  repeat_create_requests: repeatCalls,
  repeat_update_requests: updateRepeatCalls,
  omitted_variant_unchanged: true,
  leading_zero_barcode_preserved: true,
  production_requests: 0,
  inventory_payload_fields: 0,
  app_preview_version: "0.56.0",
  remaining:
    "Connect authenticated staging UI/approval outbox; validate real site plugin compatibility; no production publication approved.",
};
await save("final-parent.json", finalParent);
await save("verification.json", evidence);
console.log(JSON.stringify(evidence, null, 2));
