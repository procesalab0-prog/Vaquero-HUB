import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
export const PHOTO_CATEGORY_IDS = Object.freeze([
  7981, 11949, 21265, 35045, 36300, 37110, 38374,
]);
export async function capturePhotoRefreshCategories(
  transport = fetch,
  clock = () => new Date(),
) {
  const started_at = clock().toISOString(),
    products = [];
  for (const id of PHOTO_CATEGORY_IDS) {
    const url = `https://vaquerosm.com/wp-json/wc/store/v1/products/${id}?_fields=id,categories`;
    const response = await transport(url, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (response.status !== 200 || !response.body)
      throw Error(`CATEGORY_PRODUCT_NOT_PUBLIC:${id}`);
    if (Number(response.headers.get("content-length")) > 524288)
      throw Error("CATEGORY_RESPONSE_TOO_LARGE");
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 524288) throw Error("CATEGORY_RESPONSE_TOO_LARGE");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks),
      data = JSON.parse(bytes.toString("utf8"));
    if (
      data.id !== id ||
      !Array.isArray(data.categories) ||
      data.categories.length < 1 ||
      data.categories.length > 20 ||
      new Set(data.categories.map((c) => c.id)).size !==
        data.categories.length ||
      data.categories.some(
        (c) =>
          !Number.isSafeInteger(c.id) ||
          c.id < 1 ||
          typeof c.name !== "string" ||
          !c.name.trim() ||
          typeof c.slug !== "string" ||
          !c.slug.trim(),
      )
    )
      throw Error("CATEGORY_IDENTITY_OR_COMPLETENESS_CHANGED");
    products.push({
      id,
      url,
      method: "GET",
      status: 200,
      observed_at: clock().toISOString(),
      server_date: response.headers.get("date"),
      raw_sha256: createHash("sha256").update(bytes).digest("hex"),
      raw_json: bytes.toString("utf8"),
      data,
    });
  }
  return {
    protocol: "m9-photo-category-public-capture-1",
    origin: "https://vaquerosm.com",
    started_at,
    captured_at: clock().toISOString(),
    complete: true,
    products,
    transmitted_fields: ["public Woo product ID"],
    credentials_sent: false,
    writes_performed: 0,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3) throw Error("USAGE: NEW_PRIVATE_DIRECTORY");
  const out = resolve(process.argv[2]);
  await mkdir(out, { recursive: false, mode: 0o700 });
  const result = await capturePhotoRefreshCategories();
  await writeFile(
    resolve(out, "captura.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      products: result.products.length,
      captured_at: result.captured_at,
      fields: "id,categories",
      writes_performed: 0,
    }),
  );
}
