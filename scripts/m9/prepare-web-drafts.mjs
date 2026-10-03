import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const sha = (s) => createHash("sha256").update(s).digest("hex");
// Plain text extraction only, never an HTML sanitizer for future publication.
export function editorialText(value = "") {
  return String(value)
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\s*br\s*\/?\s*>|<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(nbsp|amp|lt|gt|quot|apos);/g,
      (_, e) =>
        ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e],
    )
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function draftFromPacket(p) {
  return {
    name: editorialText(p.name),
    base_code: editorialText(p.short_description_html),
    description: editorialText(p.description_html),
    short_description: editorialText(p.short_description_html),
    images: [...new Set(p.image_urls)].map((url) => ({ url, alt: "" })),
    categories: p.categories_source ? [p.categories_source] : [],
  };
}
export function sourceSql(packet, hash) {
  const q = (v) => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
  const statements = packet.products.map((p) => {
    if (!Number.isSafeInteger(p.woo_product_id) || p.woo_product_id <= 0)
      throw new Error("INVALID_PARENT");
    return `do $seed$ declare pid uuid; begin\n select product_id into strict pid from app.m9_products where woo_id=${p.woo_product_id};\n perform app.validate_web_content(${q(draftFromPacket(p))});\n if exists(select 1 from app.web_content_sources where product_id=pid and source_sha256<>'${hash}') then raise exception 'WEB_SOURCE_CHANGED_REVIEW_REQUIRED'; end if;\n insert into app.web_content_sources(product_id,source_sha256,snapshot,suggested_content) values(pid,'${hash}',${q(p)},${q(draftFromPacket(p))}) on conflict(product_id) do update set suggested_content=excluded.suggested_content where app.web_content_sources.source_sha256=excluded.source_sha256 and not exists(select 1 from app.web_product_drafts where product_id=pid);\n end $seed$;`;
  });
  return `begin;\nselect app.assert_sicar_staging_enabled();\n${statements.join("\n")}\ncommit;\n`;
}
async function main() {
  const [input, hashFile, out] = process.argv.slice(2);
  if (!input || !hashFile || !out)
    throw new Error("Usage: prepare-web-drafts.mjs CONTENT HASHES NEW_OUTPUT");
  const raw = await readFile(input);
  const hashes = JSON.parse(await readFile(hashFile, "utf8"));
  if (sha(raw) !== hashes["contenido.json"])
    throw new Error("SOURCE_HASH_MISMATCH");
  const packet = JSON.parse(raw);
  if (
    packet.version !== "m9-web-content-1" ||
    packet.woo_writes_enabled !== false ||
    packet.inventory_included !== false ||
    packet.products.length !== 40
  )
    throw new Error("INVALID_PILOT_PACKET");
  const sql = sourceSql(packet, sha(raw));
  await mkdir(out);
  await writeFile(resolve(out, "sources.sql"), sql, { flag: "wx" });
  await writeFile(
    resolve(out, "manifest.json"),
    JSON.stringify(
      {
        version: "m9-web-drafts-1",
        source_sha256: sha(raw),
        sql_sha256: sha(sql),
        products: packet.products.length,
        purpose: "STAGING_EDITORIAL_SOURCES_ONLY",
        woo_writes: false,
        inventory: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({ products: packet.products.length, sql_sha256: sha(sql) }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
