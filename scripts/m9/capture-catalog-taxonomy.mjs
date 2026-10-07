import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const [snapshotPath, out] = process.argv.slice(2);
if (!out) throw Error("Usage: STAGING_CATALOG.json NEW_OUTPUT");
const bytes = await fs.readFile(snapshotPath),
  snapshot = JSON.parse(bytes);
if (
  snapshot.project_id !== "zsezjtswqeijboezvado" ||
  !Array.isArray(snapshot.rows)
)
  throw Error("STAGING_REQUIRED");
const ids = [
  ...new Set(snapshot.rows.map((r) => r.current.woo_product_id)),
].sort((a, b) => a - b);
if (ids.some((id) => !Number.isSafeInteger(id) || id < 1))
  throw Error("INVALID_IDS");
await fs.mkdir(out);
const sha = (value) => createHash("sha256").update(value).digest("hex"),
  hashes = {},
  requests = [];
async function get(path, file) {
  const url = "https://vaquerosm.com/wp-json/wc/store/v1/" + path;
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error("PUBLIC_HTTP_" + response.status);
  const raw = await response.text(),
    data = JSON.parse(raw);
  if (!Array.isArray(data)) throw Error("EXPECTED_COLLECTION");
  await fs.writeFile(resolve(out, file), raw, { flag: "wx" });
  hashes[file] = sha(raw);
  const total = Number(response.headers.get("x-wp-total")),
    pages = Number(response.headers.get("x-wp-totalpages"));
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(pages) ||
    pages < 0
  )
    throw Error("PAGINATION_REQUIRED");
  requests.push({ url, file, total, pages, received: data.length });
  return { data, total, pages };
}
async function taxonomy(prefix) {
  const all = [];
  let expected, pages;
  for (let page = 1; page <= (pages ?? 1); page++) {
    const r = await get(
      `products/categories?per_page=100&page=${page}&hide_empty=false`,
      `${prefix}-${page}.json`,
    );
    expected ??= r.total;
    pages ??= r.pages;
    if (expected !== r.total || pages !== r.pages || pages > 100)
      throw Error("TAXONOMY_CHANGED");
    all.push(...r.data);
  }
  if (
    all.length !== expected ||
    new Set(all.map((c) => c.id)).size !== expected
  )
    throw Error("INCOMPLETE_TAXONOMY");
  return all.sort((a, b) => a.id - b.id);
}
const categories = await taxonomy("categories");
const products = [];
for (let i = 0; i < ids.length; i += 100) {
  const batch = ids.slice(i, i + 100);
  const r = await get(
    `products?include=${batch.join(",")}&per_page=100&catalog_visibility=any&_fields=id,categories`,
    `products-${String(i / 100 + 1).padStart(2, "0")}.json`,
  );
  if (
    r.pages > 1 ||
    r.total !== r.data.length ||
    new Set(r.data.map((p) => p.id)).size !== r.data.length ||
    r.data.some((p) => !batch.includes(p.id) || !Array.isArray(p.categories))
  )
    throw Error("INVALID_PRODUCT_COLLECTION");
  products.push(...r.data);
  console.log(
    JSON.stringify({
      requested: Math.min(i + 100, ids.length),
      returned: products.length,
    }),
  );
}
const finalCategories = await taxonomy("categories-final");
const identity = (cs) =>
  cs.map((c) => ({ id: c.id, name: c.name, parent: c.parent, slug: c.slug }));
if (
  JSON.stringify(identity(categories)) !==
  JSON.stringify(identity(finalCategories))
)
  throw Error("TAXONOMY_CHANGED_DURING_CAPTURE");
const capture = {
  version: "m9-catalog-public-taxonomy-1",
  mode: "PUBLIC_GET_ONLY",
  captured_at: new Date().toISOString(),
  catalog_snapshot_sha256: sha(bytes),
  requested_ids: ids,
  categories,
  products: products.sort((a, b) => a.id - b.id),
  not_returned_ids: ids.filter((id) => !products.some((p) => p.id === id)),
  requests,
  pagination_complete: true,
  woo_writes: false,
  inventory_included: false,
};
const raw = JSON.stringify(capture, null, 2) + "\n";
await fs.writeFile(resolve(out, "taxonomy.json"), raw, { flag: "wx" });
hashes["taxonomy.json"] = sha(raw);
await fs.writeFile(
  resolve(out, "sha256.json"),
  JSON.stringify(hashes, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    categories: categories.length,
    requested: ids.length,
    returned: products.length,
    not_returned: capture.not_returned_ids.length,
  }),
);
