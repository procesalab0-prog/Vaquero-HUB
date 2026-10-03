import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifiedFile } from "./review-web-families.mjs";
import { sha256 } from "./prepare-web-content.mjs";
import { stable } from "./woo-test/plan.mjs";

// Extends the offline compare-source.py workflow with independent source and
// reconciliation deltas. Nothing here generates an import or an inventory write.
const inventory = new Set(["existencia", "inv_min", "inv_max"]);
const money = (s) => {
  if (typeof s !== "string" || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ""] = s.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const matching = (r) => ({
  classification: r.classification ?? null,
  manual_review: r.manual_review ?? null,
  product_id: r.product_id ?? null,
  variation_id: r.variation_id ?? null,
  attributes: [...(r.attributes ?? [])].sort((a, b) =>
    stable(a).localeCompare(stable(b)),
  ),
  issues: [...(r.issues ?? [])].sort(),
  commercial_checks: [...(r.commercial_checks ?? [])].sort(),
});
function index(rows) {
  const map = new Map();
  for (const r of rows) {
    if (
      typeof r.barcode !== "string" ||
      !r.barcode ||
      !r.fields ||
      typeof r.fields !== "object"
    )
      throw new Error("INVALID_SOURCE_ROW");
    map.set(r.barcode, [...(map.get(r.barcode) ?? []), r]);
  }
  return map;
}
export function sourceDelta(previous, current) {
  const before = index(previous),
    after = index(current),
    items = [];
  for (const barcode of [
    ...new Set([...before.keys(), ...after.keys()]),
  ].sort()) {
    const old = before.get(barcode) ?? [],
      next = after.get(barcode) ?? [];
    if (old.length > 1 || next.length > 1) {
      items.push({
        barcode,
        state: "DUPLICATE_MANUAL_REVIEW",
        previous_rows: old.length,
        current_rows: next.length,
      });
      continue;
    }
    if (!next.length) {
      items.push({
        barcode,
        state: "ABSENT_MANUAL_REVIEW_NO_DELETE",
        description: old[0].description,
      });
      continue;
    }
    if (!old.length) {
      items.push({
        barcode,
        state: "NEW_MANUAL_REVIEW",
        description: next[0].description,
        reconciliation: matching(next[0]),
      });
      continue;
    }
    const a = old[0],
      b = next[0],
      changes = {},
      inventoryFields = [];
    for (const field of [
      ...new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]),
    ].sort()) {
      if (a.fields[field] === b.fields[field]) continue;
      if (inventory.has(field)) inventoryFields.push(field);
      else
        changes[field] = {
          before: a.fields[field] ?? null,
          after: b.fields[field] ?? null,
        };
    }
    const reconciliationChanged = stable(matching(a)) !== stable(matching(b));
    const fields = Object.keys(changes);
    let state = "UNCHANGED";
    if (fields.length) {
      state = "CATALOG_CHANGE_MANUAL_REVIEW";
      if (fields.length === 1 && fields[0] === "precio1") {
        const x = money(a.fields.precio1),
          y = money(b.fields.precio1);
        state =
          x !== null && y !== null
            ? x === y
              ? "PRICE_FORMAT_ONLY"
              : "PUBLIC_PRICE_CHANGE_REVIEW"
            : "INVALID_PUBLIC_PRICE_REVIEW";
      }
    } else if (reconciliationChanged) state = "RECONCILIATION_CHANGE_ONLY";
    else if (inventoryFields.length) state = "INVENTORY_ONLY_EXCLUDED";
    items.push({
      barcode,
      state,
      changes,
      inventory_fields_changed: inventoryFields,
      reconciliation_changed: reconciliationChanged,
      ...(reconciliationChanged
        ? {
            reconciliation_before: matching(a),
            reconciliation_after: matching(b),
          }
        : {}),
    });
  }
  const counts = {};
  for (const item of items) counts[item.state] = (counts[item.state] ?? 0) + 1;
  return {
    version: "m9-source-delta-1",
    mode: "OFFLINE_READ_ONLY",
    automatic_import_allowed: false,
    absence_means_deletion: false,
    inventory_included: false,
    woo_writes_enabled: false,
    previous_row_count: previous.length,
    current_row_count: current.length,
    counts,
    reconciliation_changes: items.filter((i) => i.reconciliation_changed)
      .length,
    inventory_changed_rows_excluded: items.filter(
      (i) => i.inventory_fields_changed?.length,
    ).length,
    items,
  };
}
async function main() {
  const [oldDir, newDir, out] = process.argv.slice(2);
  if (process.argv.length !== 5)
    throw new Error("Usage: PREVIOUS_REPORT CURRENT_REPORT NEW_OUTPUT_DIR");
  const oldRows = await verifiedFile(oldDir, "filas.json"),
    newRows = await verifiedFile(newDir, "filas.json");
  const oldManifest = await verifiedFile(oldDir, "manifest.json"),
    newManifest = await verifiedFile(newDir, "manifest.json");
  const result = sourceDelta(oldRows.data, newRows.data);
  result.sources = {
    previous: { rows_sha256: sha256(oldRows.raw), manifest: oldManifest.data },
    current: { rows_sha256: sha256(newRows.raw), manifest: newManifest.data },
    same_sicar_file:
      oldManifest.data.sicar_sha256 === newManifest.data.sicar_sha256,
    same_woo_file: oldManifest.data.woo_sha256 === newManifest.data.woo_sha256,
    same_rules:
      oldManifest.data.rules_version === newManifest.data.rules_version,
  };
  const files = {
    "delta.json": JSON.stringify(result, null, 2) + "\n",
    "resumen.md": `# Comparación de cortes SICAR + WooCommerce\n\nSólo lectura. No es un lote de importación. Las ausencias no autorizan bajas; existencias excluidas.\n\nFilas anteriores: ${result.previous_row_count}. Filas actuales: ${result.current_row_count}.\n\n${Object.entries(
      result.counts,
    )
      .map(([k, v]) => `- ${k}: ${v}`)
      .join(
        "\n",
      )}\n\nCambios de conciliación: ${result.reconciliation_changes}. Filas con datos de inventario cambiados (excluidos): ${result.inventory_changed_rows_excluded}.\n\nMismo archivo SICAR: ${result.sources.same_sicar_file}. Mismo archivo Woo: ${result.sources.same_woo_file}. Mismas reglas: ${result.sources.same_rules}. Los cambios de reglas/conciliación no demuestran cambios en la mercancía.\n\nUn precio nuevo requiere conciliar SICAR, comprobar promociones y validar el destino. La cola actual todavía requiere una nueva revisión editorial: no inventar un cambio de texto para reenviar un precio.\n`,
  };
  await mkdir(resolve(out));
  for (const [name, content] of Object.entries(files))
    await writeFile(resolve(out, name), content);
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(v)])),
      null,
      2,
    ) + "\n",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
