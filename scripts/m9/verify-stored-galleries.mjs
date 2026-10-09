import fs from "node:fs/promises";
import { fetchPhoto } from "./woo-remote/process-job.mjs";
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error("Usage: MANIFEST.json NEW_REPORT.json");
const manifest = JSON.parse(await fs.readFile(input, "utf8"));
await fs.writeFile(output, JSON.stringify({ status: "RUNNING" }), {
  flag: "wx",
});
const queue = manifest.products.flatMap((p) =>
  p.images.map((i) => ({ ...i, product_id: p.product_id })),
);
const results = [];
async function worker() {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    try {
      const url = new URL(item.url);
      const prefix = `/storage/v1/object/public/product-images/${item.product_id}/`;
      if (
        url.origin !== "https://zsezjtswqeijboezvado.supabase.co" ||
        !url.pathname.startsWith(prefix)
      )
        throw new Error("UNEXPECTED_DESTINATION");
      const expected = url.pathname
        .slice(prefix.length)
        .match(/^([a-f0-9]{64})\.(jpg|png|webp)$/)?.[1];
      if (!expected) throw new Error("INVALID_HASH_FILENAME");
      const photo = await fetchPhoto(item.url);
      if (photo.sha256 !== expected) throw new Error("STORED_BYTES_DIFFER");
      results.push({
        product_id: item.product_id,
        url: item.url,
        sha256: photo.sha256,
        verified: true,
      });
    } catch (e) {
      results.push({
        product_id: item.product_id,
        url: item.url,
        verified: false,
        error: e.message,
      });
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
results.sort((a, b) => a.url.localeCompare(b.url));
const report = {
  version: "m9-storage-byte-audit-1",
  checked_at: new Date().toISOString(),
  products: manifest.products.length,
  images: results.length,
  verified: results.filter((r) => r.verified).length,
  results,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    products: report.products,
    images: report.images,
    verified: report.verified,
  }),
);
if (report.verified !== report.images) process.exitCode = 1;
