// Real Woo local only, against the synthetic family from rehearse-family.mjs.
// Temporary price + restoration, never a claimed staging/production import.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { assert, hash, localStore } from "./plan.mjs";
import { runJob, wooClient } from "./worker.mjs";
const [baselineDir, runtimeDir, outputDir] = process.argv.slice(2);
assert(
  baselineDir && runtimeDir && outputDir,
  "USAGE_BASELINE_RUNTIME_NEW_OUTPUT",
);
const read = async (d, n) => JSON.parse(await readFile(resolve(d, n), "utf8"));
const input = await read(baselineDir, "update-input.json");
const baseline = await read(baselineDir, "final-parent.json");
const siblings = await read(baselineDir, "final-variants.json");
assert(
  input.content.name.startsWith("ENSAYO — ") &&
    input.variants.length === 1 &&
    input.variants[0].sku.startsWith("M9-LAB-"),
  "SYNTHETIC_FIXTURE_ONLY",
);
const origin = localStore(input.store);
const auth = await read(runtimeDir, "private/auth.json");
const authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
const isolationResponse = await fetch(
  `${origin}/wp-json/m9-local/v1/isolation`,
  {
    headers: { Authorization: authorization },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
assert(isolationResponse.ok, "ISOLATION_UNAVAILABLE");
const isolation = await isolationResponse.json();
assert(
  isolation.environment === "local" &&
    isolation.url === origin &&
    isolation.mail_blocked &&
    isolation.outbound_blocked &&
    isolation.cron_disabled &&
    !isolation.webhooks_enabled &&
    isolation.payment_gateways === 0 &&
    isolation.orders === 0,
  "ISOLATION_FAILED",
);
const request = wooClient(input.store, authorization);
const pid = baseline.id;
assert(
  hash(await request("GET", `products/${pid}`)) === hash(baseline),
  "PARENT_BASELINE_CHANGED",
);
for (const child of siblings)
  assert(
    hash(await request("GET", `products/${pid}/variations/${child.id}`)) ===
      hash(child),
    "CHILD_BASELINE_CHANGED",
  );
await mkdir(outputDir, { mode: 0o700 });
const save = (n, x) =>
  writeFile(resolve(outputDir, n), JSON.stringify(x, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const journalDir = resolve(runtimeDir, "private/worker-journal");
const originalPrice = input.variants[0].price_cents;
const selected = siblings.find((v) => v.id === input.target.variants[0].id);
input.revision += 1;
input.variants[0].price_cents += 100;
input.target.snapshot = baseline;
input.target.variants[0].snapshot = selected;
await save("price-input.json", input);
let result = await runJob({ input, journalDir, request });
await save("price-result.json", result);
assert(result.state === "SUCCEEDED", "PRICE_REVIEW_REQUIRED");
const changedParent = await request("GET", `products/${pid}`);
const changed = await request(
  "GET",
  `products/${pid}/variations/${selected.id}`,
);
await save("price-parent.json", changedParent);
await save("price-child.json", changed);
assert(
  changed.regular_price === (input.variants[0].price_cents / 100).toFixed(2),
  "PRICE_NOT_APPLIED",
);
assert(
  changedParent.description === baseline.description &&
    changedParent.short_description === baseline.short_description &&
    changedParent.name === baseline.name,
  "TEXT_CHANGED",
);
for (const key of [
  "sku",
  "attributes",
  "manage_stock",
  "stock_quantity",
  "stock_status",
  "backorders",
  "sale_price",
])
  assert(hash(changed[key]) === hash(selected[key]), `CHILD_${key}_CHANGED`);
for (const child of siblings.filter((v) => v.id !== selected.id))
  assert(
    hash(await request("GET", `products/${pid}/variations/${child.id}`)) ===
      hash(child),
    "SIBLING_CHANGED",
  );
let calls = 0;
await runJob({
  input,
  journalDir,
  request: async (...args) => {
    calls++;
    return request(...args);
  },
});
assert(calls === 0, "REPEAT_REQUESTS");
const restore = structuredClone(input);
restore.revision += 1;
restore.variants[0].price_cents = originalPrice;
restore.target.snapshot = changedParent;
restore.target.variants[0].snapshot = changed;
await save("restore-input.json", restore);
result = await runJob({ input: restore, journalDir, request });
await save("restore-result.json", result);
assert(result.state === "SUCCEEDED", "RESTORE_REVIEW_REQUIRED");
const restored = await request(
  "GET",
  `products/${pid}/variations/${selected.id}`,
);
assert(restored.regular_price === selected.regular_price, "RESTORE_FAILED");
await save("restored-child.json", restored);
await save("restored-parent.json", await request("GET", `products/${pid}`));
const verification = {
  kind: "SYNTHETIC_LOCAL_PRICE_ONLY_AND_RESTORE",
  local_product_id: pid,
  local_variant_id: selected.id,
  original_price_cents: originalPrice,
  temporary_price_cents: originalPrice + 100,
  restored: true,
  editorial_content_unchanged: true,
  other_variants_unchanged: 4,
  repeat_requests: calls,
  production_writes: 0,
  staging_price_writes: 0,
  isolation,
};
await save("verification.json", verification);
console.log(JSON.stringify(verification));
