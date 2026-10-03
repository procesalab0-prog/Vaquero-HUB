import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./prepare-web-content.mjs";

// Public GET only, fixed host, no credentials, redirects or remote mutations.
const [contentPath, output] = process.argv.slice(2);
if (!contentPath || !output || process.argv.length !== 4)
  throw new Error("Usage: node capture-web-taxonomy.mjs CONTENT NEW_DIRECTORY");
const contentRaw = await readFile(contentPath);
const content = JSON.parse(contentRaw);
const ids = content.products.map((p) => p.woo_product_id);
if (
  ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
  new Set(ids).size !== ids.length
)
  throw new Error("INVALID_PRODUCT_IDS");
await mkdir(output);
const pages = [],
  products = [],
  hashes = {};
async function get(path, file) {
  const url = `https://vaquerosm.com/wp-json/wc/store/v1/${path}`;
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  const raw = await response.text();
  if (!response.ok && response.status !== 404)
    throw new Error(`HTTP_${response.status}`);
  const data = JSON.parse(raw);
  await writeFile(resolve(output, file), raw, { flag: "wx" });
  hashes[file] = sha256(raw);
  return {
    url,
    file,
    status: response.status,
    data,
    total: Number(response.headers.get("x-wp-total")),
    pages: Number(response.headers.get("x-wp-totalpages")),
  };
}
let total, totalPages;
for (let page = 1; page <= (totalPages ?? 1); page++) {
  const result = await get(
    `products/categories?per_page=100&page=${page}&hide_empty=false`,
    `categories-${page}.json`,
  );
  if (
    result.status !== 200 ||
    !Array.isArray(result.data) ||
    !Number.isSafeInteger(result.total) ||
    result.total < 1 ||
    !Number.isSafeInteger(result.pages) ||
    result.pages < 1 ||
    result.pages > 100
  )
    throw new Error("INVALID_PAGINATION");
  total ??= result.total;
  totalPages ??= result.pages;
  if (total !== result.total || totalPages !== result.pages)
    throw new Error("PAGINATION_CHANGED");
  pages.push(result);
}
const categories = pages.flatMap((p) => p.data);
if (
  categories.length !== total ||
  new Set(categories.map((c) => c.id)).size !== total
)
  throw new Error("INCOMPLETE_CATEGORIES");
for (const id of ids.sort((a, b) => a - b)) {
  const result = await get(`products/${id}`, `product-${id}.json`);
  if (result.status === 200 && result.data.id !== id)
    throw new Error("PRODUCT_ID_MISMATCH");
  products.push({ id, ...result });
}
const snapshot = {
  version: "m9-public-taxonomy-1",
  scope: "PUBLIC_STORE_API_HIDE_EMPTY_FALSE_NOT_ADMIN_EXPORT",
  captured_at: new Date().toISOString(),
  content_sha256: sha256(contentRaw),
  pagination_complete: true,
  total,
  total_pages: totalPages,
  categories,
  products,
  pages: pages.map(({ data, ...p }) => ({ ...p, count: data.length })),
};
const raw = JSON.stringify(snapshot, null, 2) + "\n";
await writeFile(resolve(output, "taxonomy.json"), raw, { flag: "wx" });
hashes["taxonomy.json"] = sha256(raw);
await writeFile(
  resolve(output, "sha256.json"),
  JSON.stringify(hashes, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    categories: total,
    products: products.length,
    unavailable: products.filter((p) => p.status !== 200).length,
  }),
);
