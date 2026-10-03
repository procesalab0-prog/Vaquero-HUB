import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sourceDelta } from "./prepare-source-delta.mjs";
import { verifiedFile } from "./review-web-families.mjs";
import { sha256 } from "./prepare-web-content.mjs";
import { stable } from "./woo-test/plan.mjs";

// Operator rehearsal only: produces evidence, never an import payload or SQL.
export function checkStaging(rows, snapshot, woo) {
  if (
    snapshot.project_id !== "zsezjtswqeijboezvado" ||
    !Array.isArray(snapshot.rows) ||
    !snapshot.rows.length
  )
    throw new Error("STAGING_SNAPSHOT_REQUIRED");
  if (snapshot.inventory_rows !== 0 || snapshot.inventory_movements !== 0)
    throw new Error("INVENTORY_NOT_EXCLUDED");
  if (woo.pagination_complete !== true || !Array.isArray(woo.products))
    throw new Error("COMPLETE_WOO_SNAPSHOT_REQUIRED");
  const byCode = new Map(),
    seen = new Set(),
    parents = new Map();
  for (const p of woo.products) {
    if (parents.has(p.id)) throw new Error("DUPLICATE_WOO_PARENT");
    parents.set(p.id, p);
  }
  for (const r of rows) {
    if (typeof r.barcode !== "string" || !r.barcode || !r.fields)
      throw new Error("INVALID_SOURCE_ROW");
    byCode.set(r.barcode, [...(byCode.get(r.barcode) ?? []), r]);
  }
  return snapshot.rows
    .map((v) => {
      if (typeof v.barcode !== "string" || !v.barcode || seen.has(v.barcode))
        throw new Error("INVALID_OR_DUPLICATE_STAGING_CODE");
      seen.add(v.barcode);
      const matches = byCode.get(v.barcode) ?? [];
      if (matches.length !== 1)
        return {
          barcode: v.barcode,
          state: matches.length
            ? "DUPLICATE_MANUAL_REVIEW"
            : "ABSENT_MANUAL_REVIEW_NO_DELETE",
        };
      const r = matches[0],
        f = r.fields,
        parent = parents.get(r.product_id);
      const [whole, fraction = ""] = String(f.precio1 ?? "").split(".");
      const price = /^\d+(\.\d{1,2})?$/.test(f.precio1 ?? "")
        ? Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
        : null;
      const attributes = Object.fromEntries(
        (r.attributes ?? []).map((a) => [
          { Talla: "TALLA", Color: "COLOR", Largo: "LARGO" }[a.name] ?? a.name,
          a.value,
        ]),
      );
      const expected = {
        barcode: f["clave1 *"],
        product_name: parent?.name ?? null,
        description: f["descripción *"],
        department: f.departamento,
        section: f.categoria,
        price_cents: price,
        cost_cents: null,
        attributes,
        woo_product_id: r.product_id,
        woo_variation_id: r.variation_id,
      };
      const differences = Object.keys(expected).filter(
        (k) => stable(v[k]) !== stable(expected[k]),
      );
      if (!Number.isSafeInteger(price) || price <= 0)
        differences.push("invalid_public_price");
      if (!parent) differences.push("missing_woo_parent");
      return {
        barcode: v.barcode,
        state: differences.length
          ? "CATALOG_CHANGE_MANUAL_REVIEW"
          : "CATALOG_IDENTICAL",
        differences,
        source_manual_review:
          !!r.manual_review ||
          r.classification !== "MATCH_EXACT_VARIANT" ||
          !!r.display_only ||
          !!r.issues?.length ||
          !!r.commercial_checks?.length,
        source_issues: r.issues ?? [],
        commercial_checks: r.commercial_checks ?? [],
      };
    })
    .sort((a, b) => a.barcode.localeCompare(b.barcode));
}

export function checkFamilies(snapshot, woo) {
  return [...new Set(snapshot.rows.map((r) => r.woo_product_id))]
    .sort((a, b) => a - b)
    .map((id) => {
      const parent = woo.products.find((p) => p.id === id);
      const rows = snapshot.rows.filter((r) => r.woo_product_id === id);
      const expected =
        parent?.type === "variable"
          ? (parent.variations ?? []).map((v) => v.id)
          : [];
      const actual = rows
        .map((r) => r.woo_variation_id)
        .filter((id) => id !== null);
      const missing = expected.filter((id) => !actual.includes(id));
      const extra = actual.filter((id) => !expected.includes(id));
      const departments = [...new Set(rows.map((r) => r.department))].sort();
      const holds = [];
      if (!parent || !["simple", "variable"].includes(parent.type))
        holds.push("SOURCE_TYPE_REVIEW");
      if (
        missing.length ||
        extra.length ||
        (parent?.type === "variable" && expected.length === 0)
      )
        holds.push("INCOMPLETE_WOO_FAMILY_REVIEW");
      if (departments.length > 1) holds.push("DIVERGENT_DEPARTMENTS_REVIEW");
      return {
        woo_product_id: id,
        departments,
        missing_woo_variation_ids: missing,
        unexpected_woo_variation_ids: extra,
        holds,
        commercial_approved: false,
      };
    });
}

export async function rehearse(
  previousDir,
  currentDir,
  snapshotPath,
  wooPath,
  sicarPath,
  out,
) {
  const previous = await verifiedFile(previousDir, "filas.json");
  const current = await verifiedFile(currentDir, "filas.json");
  const manifest = await verifiedFile(currentDir, "manifest.json");
  const [snapshotRaw, wooRaw, sicarRaw] = await Promise.all(
    [snapshotPath, wooPath, sicarPath].map((p) => readFile(p)),
  );
  if (
    sha256(wooRaw) !== manifest.data.woo_sha256 ||
    sha256(sicarRaw) !== manifest.data.sicar_sha256
  )
    throw new Error("SOURCE_HASH_MISMATCH");
  const snapshot = JSON.parse(snapshotRaw),
    woo = JSON.parse(wooRaw);
  const staged = checkStaging(current.data, snapshot, woo);
  const delta = sourceDelta(previous.data, current.data);
  const report = {
    version: "m9-cutover-rehearsal-1",
    mode: "OFFLINE_READ_ONLY",
    production_allowed: false,
    automatic_import_allowed: false,
    inventory_included: false,
    absence_means_deletion: false,
    sources: {
      previous_rows_sha256: sha256(previous.raw),
      current_rows_sha256: sha256(current.raw),
      manifest_sha256: sha256(manifest.raw),
      staging_sha256: sha256(snapshotRaw),
      woo_sha256: sha256(wooRaw),
      sicar_sha256: sha256(sicarRaw),
    },
    source_changes: delta.counts,
    inventory_changed_rows_excluded: delta.inventory_changed_rows_excluded,
    staged_rows: staged.length,
    catalogue_identical: staged.filter((r) => r.state === "CATALOG_IDENTICAL")
      .length,
    staged_review_required: staged.filter(
      (r) => r.state !== "CATALOG_IDENTICAL" || r.source_manual_review,
    ).length,
    catalogue_match_is_not_commercial_approval: true,
    families: checkFamilies(snapshot, woo),
    production_gates_pending: [
      "FINAL_FRESH_AUTHENTICATED_WOO_AND_SICAR_CUT",
      "PHYSICAL_BARCODE_TEST",
      "COMMERCIAL_REVIEW",
      "OTHER_CHAT_INTEGRATION_AND_TEST",
      "PRODUCTION_BACKUP_AND_RECOVERY_PLAN",
      "EXPLICIT_PRODUCTION_AUTHORIZATION",
    ],
    staged,
    changes: delta.items.filter((r) => r.state !== "UNCHANGED"),
  };
  await mkdir(out);
  const raw = JSON.stringify(report, null, 2) + "\n";
  await writeFile(resolve(out, "ensayo.json"), raw, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify({ "ensayo.json": sha256(raw) }, null, 2) + "\n",
    { flag: "wx" },
  );
  return {
    staged_rows: report.staged_rows,
    catalogue_identical: report.catalogue_identical,
    staged_review_required: report.staged_review_required,
    source_changes: report.source_changes,
    production_allowed: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 8)
    throw new Error(
      "Usage: PREVIOUS_REPORT CURRENT_REPORT STAGING_JSON WOO_JSON SICAR_XLSX NEW_OUTPUT_DIR",
    );
  console.log(JSON.stringify(await rehearse(...process.argv.slice(2))));
}
