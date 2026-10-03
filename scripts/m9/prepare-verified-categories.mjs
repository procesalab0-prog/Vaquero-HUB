import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifiedFile } from "./review-web-families.mjs";
import { sha256 } from "./prepare-web-content.mjs";
export function prepareCategories(lot, report, staging) {
  if (
    staging.project_id !== "zsezjtswqeijboezvado" ||
    staging.mode !== "READ_ONLY"
  )
    throw new Error("NOT_STAGING_EVIDENCE");
  const held = [13560, 37102],
    items = [];
  for (const p of lot.products) {
    if (held.includes(p.woo_product_id)) continue;
    const families = report.families.filter(
      (f) => f.woo_product_id === p.woo_product_id,
    );
    const sources = staging.rows.filter(
      (s) => s.snapshot.woo_product_id === p.woo_product_id,
    );
    if (families.length !== 1 || sources.length !== 1)
      throw new Error("MISSING_OR_DUPLICATE_EVIDENCE");
    const f = families[0],
      s = sources[0];
    if (
      f.issues.length ||
      f.categories.state !== "VERIFIED_PATH_AND_PUBLIC_MEMBERSHIP" ||
      !f.categories.verified_ids?.length
    )
      throw new Error("CATEGORY_REVIEW_REQUIRED");
    if (s.human_content !== null || s.revision !== null)
      throw new Error("HUMAN_DRAFT_REVIEW_REQUIRED");
    if (s.snapshot.categories_source !== f.categories.source_csv)
      throw new Error("SOURCE_CATEGORIES_CHANGED");
    const mappings = f.categories.verified_ids.map((id) => {
      const found = report.categories.filter((c) => c.id === id);
      if (found.length !== 1) throw new Error("CATEGORY_ID_MISSING");
      return { id, path: found[0].path };
    });
    if (new Set(mappings.map((m) => m.id)).size !== mappings.length)
      throw new Error("DUPLICATE_CATEGORY_ID");
    items.push({
      woo_product_id: p.woo_product_id,
      product_id: s.product_id,
      source_sha256: s.source_sha256,
      expected_source_categories: s.snapshot.categories_source,
      expected_suggested_content: s.suggested_content,
      category_evidence: mappings,
      suggested_content: {
        ...s.suggested_content,
        categories: mappings.map((m) => m.path),
      },
      source_snapshot_unchanged: true,
      send_allowed: false,
    });
  }
  return {
    version: "m9-verified-categories-preparation-1",
    purpose: "STAGING_PREFLIGHT_NOT_WOO_PAYLOAD",
    held_parent_ids: held,
    items,
  };
}
export function preflightSql(packet) {
  const q = (v) => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
  return (
    "begin read only;\nselect app.assert_sicar_staging_enabled();\n" +
    packet.items
      .map((x) => {
        if (
          !/^[0-9a-f-]{36}$/.test(x.product_id) ||
          !/^[0-9a-f]{64}$/.test(x.source_sha256)
        )
          throw new Error("INVALID_IDENTIFIERS");
        return `select ${x.woo_product_id} as woo_product_id, s.source_sha256='${x.source_sha256}' as source_hash_matches, s.suggested_content=${q(x.expected_suggested_content)} as suggested_content_matches, s.snapshot->>'categories_source'=${q(x.expected_source_categories)}#>>'{}' as source_categories_match, not exists(select 1 from app.web_product_drafts d where d.product_id=s.product_id) as no_human_draft, app.validate_web_content(${q(x.suggested_content)}) as validation from app.web_content_sources s where s.product_id='${x.product_id}'::uuid`;
      })
      .join("\nunion all\n") +
    ";\ncommit;\n"
  );
}
async function main() {
  const [lotDir, reportDir, stagingDir, out] = process.argv.slice(2);
  if (process.argv.length !== 6)
    throw new Error(
      "Usage: LOT_DIR FAMILY_REPORT_DIR STAGING_READ_DIR NEW_OUT",
    );
  const lot = await verifiedFile(lotDir, "lote.json"),
    report = await verifiedFile(reportDir, "familias.json"),
    staging = await verifiedFile(stagingDir, "lectura.json");
  if (lot.data.sources.family_report_sha256 !== sha256(report.raw))
    throw new Error("REPORT_HASH_MISMATCH");
  const packet = prepareCategories(lot.data, report.data, staging.data);
  packet.sources = {
    lot_sha256: sha256(lot.raw),
    report_sha256: sha256(report.raw),
    staging_read_sha256: sha256(staging.raw),
  };
  const files = {
    "categorias.json": JSON.stringify(packet, null, 2) + "\n",
    "preflight.sql": preflightSql(packet),
  };
  await mkdir(out);
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(out, name), value, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([n, v]) => [n, sha256(v)])),
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      families: packet.items.length,
      held: packet.held_parent_ids,
    }),
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
