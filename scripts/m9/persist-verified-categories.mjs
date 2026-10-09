import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifiedFile } from "./review-web-families.mjs";
import { sha256 } from "./prepare-web-content.mjs";
const q = (v) => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
export function bindingSql(packet, content, contentHash, evidenceHash) {
  if (
    packet.version !== "m9-verified-categories-preparation-1" ||
    packet.items.length !== 7 ||
    packet.items.some((i) => [13560, 37102].includes(i.woo_product_id))
  )
    throw new Error("INVALID_CANDIDATE_SCOPE");
  if (
    !/^[0-9a-f]{64}$/.test(evidenceHash) ||
    !/^[0-9a-f]{64}$/.test(contentHash)
  )
    throw new Error("INVALID_EVIDENCE_HASH");
  const guards = [],
    calls = [],
    ids = new Set();
  for (const i of packet.items) {
    if (
      !Number.isSafeInteger(i.woo_product_id) ||
      i.woo_product_id <= 0 ||
      !/^[0-9a-f-]{36}$/.test(i.product_id) ||
      ids.has(i.product_id) ||
      i.source_sha256 !== contentHash
    )
      throw new Error("SOURCE_MISMATCH");
    ids.add(i.product_id);
    const candidates = content.products.filter(
      (p) => p.woo_product_id === i.woo_product_id,
    );
    if (candidates.length !== 1) throw new Error("SOURCE_MISMATCH");
    guards.push(
      `do $guard$ begin perform 1 from public.products where id='${i.product_id}' for update; perform 1 from app.web_content_sources where product_id='${i.product_id}' and snapshot=${q(candidates[0])} and source_sha256='${contentHash}' for update; if not found then raise exception 'SOURCE_SNAPSHOT_CHANGED'; end if; end $guard$;`,
    );
    calls.push(
      `select ${i.woo_product_id} as woo_product_id, app.prepare_web_category_binding('${i.product_id}'::uuid,'${contentHash}','${evidenceHash}',${q(i.category_evidence)},${q(i.expected_suggested_content)}) as result`,
    );
  }
  return (
    "begin;\nselect app.assert_sicar_staging_enabled();\n" +
    guards.join("\n") +
    "\n" +
    calls.join("\nunion all\n") +
    ";\ncommit;\n"
  );
}
async function main() {
  const [packetDir, contentDir, out] = process.argv.slice(2);
  if (process.argv.length !== 5)
    throw new Error("Usage: CATEGORIES_DIR CONTENT_DIR NEW_OUT");
  const p = await verifiedFile(packetDir, "categorias.json"),
    c = await verifiedFile(contentDir, "contenido.json");
  const sql = bindingSql(p.data, c.data, sha256(c.raw), sha256(p.raw));
  await mkdir(out);
  await writeFile(resolve(out, "apply-staging.sql"), sql, { flag: "wx" });
  await writeFile(
    resolve(out, "manifest.json"),
    JSON.stringify(
      {
        version: "m9-category-persistence-1",
        target: "zsezjtswqeijboezvado",
        families: 7,
        evidence_sha256: sha256(p.raw),
        source_sha256: sha256(c.raw),
        sql_sha256: sha256(sql),
        woo_writes: false,
        inventory: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log("Prepared guarded staging SQL for 7 families");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
