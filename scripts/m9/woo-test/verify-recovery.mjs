import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { hash, assert } from "./plan.mjs";

const [runtime, backup, output] = process.argv.slice(2);
assert(
  process.argv.length === 5,
  "Usage: RESTORED_RUNTIME BACKUP NEW_REPORT_JSON",
);
const marker = JSON.parse(
  await readFile(resolve(runtime, "private/recovery.json"), "utf8"),
);
assert(
  marker.restored_root === resolve(runtime) && marker.port === 9427,
  "RESTORED_RUNTIME_REQUIRED",
);
const rawManifest = await readFile(resolve(backup, "manifest.json"));
assert(
  createHash("sha256").update(rawManifest).digest("hex") ===
    marker.backup_manifest_sha256,
  "MANIFEST_HASH_MISMATCH",
);
const manifest = JSON.parse(rawManifest);
const auth = JSON.parse(
  await readFile(resolve(runtime, "private/auth.json"), "utf8"),
);
const headers = {
  Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
};
async function request(port, path, method = "GET", expectedStatus = 200) {
  assert([9417, 9427].includes(port) && path.startsWith("/"), "LOCAL_ONLY");
  const url = `http://127.0.0.1:${port}${path}`;
  const options = {
    method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
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
  assert(r.status === expectedStatus, `LOCAL_HTTP_${r.status}`);
  return r;
}
const isolation = await (
  await request(9427, "/wp-json/m9-local/v1/isolation")
).json();
assert(
  isolation.environment === "local" &&
    isolation.url === "http://127.0.0.1:9427" &&
    isolation.recovery_read_only === true &&
    isolation.orders === 0 &&
    isolation.outbound_blocked &&
    isolation.mail_blocked &&
    isolation.cron_disabled &&
    isolation.payment_gateways === 0 &&
    !isolation.webhooks_enabled,
  "RECOVERY_ISOLATION_FAILED",
);
assert(
  (await request(9427, "/wp-json/m9-local/v1/isolation", "POST", 403))
    .status === 403,
  "RECOVERY_WRITE_NOT_BLOCKED",
);
await request(9427, "/wp-admin/", "GET", 403);
await request(9427, "/wp-json/m9-local/v1/isolation?_method=POST", "GET", 403);
await request(
  9427,
  "/wp-json/m9-local/v1/isolation?rest_route=/wp/v2/settings",
  "GET",
  403,
);
const originalIsolation = await (
  await request(9417, "/wp-json/m9-local/v1/isolation")
).json();
assert(
  originalIsolation.environment === "local" &&
    originalIsolation.url === "http://127.0.0.1:9417" &&
    originalIsolation.orders === 0 &&
    originalIsolation.outbound_blocked &&
    originalIsolation.mail_blocked &&
    originalIsolation.cron_disabled &&
    originalIsolation.payment_gateways === 0 &&
    !originalIsolation.webhooks_enabled,
  "ORIGINAL_ISOLATION_FAILED",
);
const normalize = (x) =>
  JSON.parse(
    JSON.stringify(x).replaceAll(
      "http://127.0.0.1:9427",
      "http://127.0.0.1:9417",
    ),
  );
async function all(port, path) {
  const first = await request(port, path + "?per_page=100&page=1");
  const pages = Number(first.headers.get("x-wp-totalpages")),
    total = Number(first.headers.get("x-wp-total"));
  assert(
    Number.isSafeInteger(pages) && pages >= 0 && pages <= 100,
    "BAD_PAGINATION",
  );
  let values = await first.json();
  for (let page = 2; page <= pages; page++)
    values.push(
      ...(await (
        await request(port, path + `?per_page=100&page=${page}`)
      ).json()),
    );
  assert(values.length === total, "INCOMPLETE_RESPONSE");
  return values.sort((a, b) => a.id - b.id);
}
const before = await all(9417, "/wp-json/wc/v3/products"),
  after = await all(9427, "/wp-json/wc/v3/products");
assert(
  hash(normalize(before)) === hash(normalize(after)),
  "RESTORED_PRODUCTS_DIFFER",
);
const report = [];
const images = new Map();
for (const parent of after) {
  assert(parent.status === "draft", "NON_DRAFT_PRODUCT");
  for (const img of parent.images) images.set(img.id, img);
  let children = [];
  if (parent.type === "variable") {
    const path = `/wp-json/wc/v3/products/${parent.id}/variations`;
    const originalChildren = await all(9417, path);
    children = await all(9427, path);
    assert(
      hash(normalize(originalChildren)) === hash(normalize(children)),
      "RESTORED_VARIANTS_DIFFER",
    );
    assert(
      hash(children.map((c) => c.id)) ===
        hash([...parent.variations].sort((a, b) => a - b)),
      "INCOMPLETE_FAMILY",
    );
  }
  report.push({
    parent_id: parent.id,
    name: parent.name,
    children: children.length,
    status: parent.status,
  });
}
for (const img of images.values()) {
  const u = new URL(img.src);
  assert(
    ["http://127.0.0.1:9417", "http://127.0.0.1:9427"].includes(u.origin) &&
      u.pathname.startsWith("/wp-content/uploads/"),
    "NON_LOCAL_IMAGE",
  );
  const bytes = new Uint8Array(
    await (await request(9427, u.pathname)).arrayBuffer(),
  );
  assert(
    createHash("sha256").update(bytes).digest("hex") ===
      manifest.files["wordpress" + decodeURIComponent(u.pathname)],
    "RESTORED_IMAGE_DIFFERS",
  );
}
const summary = {
  version: "m9-live-recovery-check-1",
  backup_manifest_sha256: marker.backup_manifest_sha256,
  isolation,
  original_isolation: originalIsolation,
  products: report,
  parents: report.length,
  children: report.reduce((n, p) => n + p.children, 0),
  images_verified: images.size,
  catalogue_identical: true,
  recovery_writes_blocked: true,
  recovery_admin_blocked: true,
  production_written: false,
};
await writeFile(resolve(output), JSON.stringify(summary, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    parents: summary.parents,
    children: summary.children,
    images: summary.images_verified,
    recovery_writes_blocked: true,
    recovery_admin_blocked: true,
    catalogue_identical: true,
  }),
);
