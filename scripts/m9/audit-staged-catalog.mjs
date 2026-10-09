import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const stable = (x) =>
  JSON.stringify(x, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
function cents(value) {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value))
    return null;
  const [whole, fraction = ""] = value.split(".");
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return n > 0n && n <= 100000000n ? Number(n) : null;
}

export function auditStagedCatalog(snapshot, sourceRows) {
  if (
    snapshot.project_id !== "zsezjtswqeijboezvado" ||
    !Array.isArray(snapshot.rows) ||
    !Array.isArray(sourceRows)
  )
    throw Error("STAGING_SNAPSHOT_REQUIRED");
  const byCode = new Map(),
    stagedCodes = new Map(),
    ids = new Set();
  for (const row of sourceRows)
    byCode.set(row.barcode, [...(byCode.get(row.barcode) ?? []), row]);
  for (const row of snapshot.rows)
    stagedCodes.set(
      row.current?.barcode,
      (stagedCodes.get(row.current?.barcode) ?? 0) + 1,
    );
  const results = snapshot.rows
    .map((row) => {
      const current = row.current,
        reasons = [],
        differences = [];
      if (!current || typeof current.barcode !== "string")
        throw Error("INVALID_CATALOG_ROW");
      if (!row.variant_id || ids.has(row.variant_id))
        reasons.push("DUPLICATE_OR_INVALID_VARIANT_ID");
      ids.add(row.variant_id);
      if (stagedCodes.get(current.barcode) !== 1)
        reasons.push("DUPLICATE_STAGED_BARCODE");
      if (stable(current) !== stable(row.stored))
        reasons.push("CATALOG_DIFFERS_FROM_APPLIED_ROW");
      if (current.cost_cents !== null)
        reasons.push("UNKNOWN_COST_MUST_REMAIN_NULL");
      const candidates = byCode.get(current.barcode) ?? [];
      if (candidates.length !== 1)
        reasons.push(
          candidates.length
            ? "DUPLICATE_SOURCE_CODE"
            : "SOURCE_CODE_ABSENT_NO_DELETE",
        );
      if (candidates.length === 1) {
        const source = candidates[0];
        if (
          source.fields?.["clave1 *"] !== current.barcode ||
          source.description !== source.fields?.["descripción *"]
        )
          reasons.push("SOURCE_LITERAL_IDENTITY_MISMATCH");
        const attributes = Object.fromEntries(
          (source.attributes ?? []).map((a) => [
            { Talla: "TALLA", Color: "COLOR", Largo: "LARGO" }[a.name] ??
              a.name,
            a.value,
          ]),
        );
        if (Object.keys(attributes).length !== (source.attributes ?? []).length)
          reasons.push("DUPLICATE_SOURCE_ATTRIBUTE");
        const expected = {
          barcode: source.barcode,
          description: source.description,
          department: source.fields?.departamento,
          section: source.fields?.categoria,
          price_cents: cents(source.fields?.precio1),
          attributes,
          woo_product_id: source.product_id ?? null,
          woo_variation_id: source.variation_id ?? null,
        };
        if (expected.price_cents === null)
          reasons.push("INVALID_SOURCE_PUBLIC_PRICE");
        for (const [field, value] of Object.entries(expected))
          if (stable(current[field]) !== stable(value))
            differences.push({
              field,
              current: current[field] ?? null,
              source: value ?? null,
            });
      }
      return {
        barcode: current.barcode,
        variant_id: row.variant_id,
        product_id: row.product_id,
        state:
          reasons.length || differences.length
            ? "REVIEW_REQUIRED"
            : "EXACT_SOURCE_MATCH",
        reasons: reasons.sort(),
        differences,
      };
    })
    .sort((a, b) =>
      a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0,
    );
  const inventoryClean =
    snapshot.inventory_balances === 0 && snapshot.inventory_movements === 0;
  return {
    version: "m9-full-catalog-audit-1",
    project_id: snapshot.project_id,
    mode: "READ_ONLY",
    write_allowed: false,
    summary: {
      staged_rows: results.length,
      exact_rows: results.filter((r) => r.state === "EXACT_SOURCE_MATCH")
        .length,
      review_rows: results.filter((r) => r.state === "REVIEW_REQUIRED").length,
      source_rows: sourceRows.length,
      not_staged_rows: sourceRows.filter((r) => !stagedCodes.has(r.barcode))
        .length,
      inventory_clean: inventoryClean,
      inventory_balances: snapshot.inventory_balances,
      inventory_movements: snapshot.inventory_movements,
    },
    results,
  };
}

async function main() {
  const [snapshotPath, reportPath, out] = process.argv.slice(2);
  if (!out) throw Error("Usage: SNAPSHOT.json VERIFIED_REPORT_DIR NEW_OUTPUT");
  const snapshotBytes = await readFile(snapshotPath),
    checks = JSON.parse(await readFile(resolve(reportPath, "sha256.json")));
  const sourceBytes = await readFile(resolve(reportPath, "filas.json"));
  const manifestBytes = await readFile(resolve(reportPath, "manifest.json"));
  if (
    hash(sourceBytes) !== checks["filas.json"] ||
    hash(manifestBytes) !== checks["manifest.json"]
  )
    throw Error("REPORT_CHANGED");
  const manifest = JSON.parse(manifestBytes);
  const result = auditStagedCatalog(
    JSON.parse(snapshotBytes),
    JSON.parse(sourceBytes),
  );
  result.sources = {
    snapshot_sha256: hash(snapshotBytes),
    rows_sha256: hash(sourceBytes),
    sicar_sha256: manifest.sicar_sha256,
    woo_sha256: manifest.woo_sha256,
  };
  await mkdir(out);
  const files = {
    "auditoria.json": json(result),
    "resumen.json": json(result.summary),
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(out, name), value, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(
        Object.entries(files).map(([name, value]) => [name, hash(value)]),
      ),
    ),
    { flag: "wx" },
  );
  console.log(result.summary);
  if (result.summary.review_rows || !result.summary.inventory_clean)
    process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
