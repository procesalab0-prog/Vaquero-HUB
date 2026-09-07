#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { loadSicarWorkbook } from "./sicar/workbook.mjs";
import {
  applyCatalogSync,
  assertApprovedReport,
  assertStagingUrl,
  catalogRow,
  sha256Text,
} from "./sicar/sync.mjs";

function usage() {
  console.error(
    "Uso: pnpm sicar:sync -- <export.xlsx> --analysis reporte.json --confirm-sha SHA --approved-by CODIGO [--apply-catalog] [--output conciliacion.json]",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
if (!args.length || args.includes("--help")) usage();
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const workbookPath = resolve(args[0]);
const analysisPath = option("--analysis")
  ? resolve(option("--analysis"))
  : null;
const confirmSha = option("--confirm-sha");
const approvedBy = option("--approved-by");
const shouldApply = args.includes("--apply-catalog");
if (!analysisPath || !confirmSha) usage();

const workbook = await loadSicarWorkbook(workbookPath);
const reportText = await readFile(analysisPath, "utf8");
const report = JSON.parse(reportText);
const approval = assertApprovedReport({
  report,
  workbookSha: workbook.sha256,
  confirmSha,
});
const catalogRows = workbook.rows.map(catalogRow);

if (!shouldApply) {
  console.log(
    JSON.stringify(
      {
        mode: "DRY_RUN_READ_ONLY",
        file: basename(workbookPath),
        sha256: workbook.sha256,
        rows: catalogRows.length,
        symbology: approval.symbology,
        barcodeTestReference: approval.barcodeTestReference,
        readyForCatalogStaging: true,
        writesDatabase: false,
        touchesInventory: false,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!approvedBy) usage();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("MISSING_SUPABASE_SERVER_ENV");
assertStagingUrl(url);
const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const result = await applyCatalogSync({
  supabase,
  workbook,
  report,
  reportSha: sha256Text(reportText),
  approvedBy,
});
const reconciliation = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: "CATALOG_STAGING",
  source: { file: basename(workbookPath), sha256: workbook.sha256 },
  result,
  guarantees: {
    stagingOnly: true,
    touchesInventory: false,
    deactivatesAbsentProducts: false,
  },
};
const outputPath = resolve(
  option("--output") ??
    `sicar-reconciliation-${new Date().toISOString().slice(0, 10)}.json`,
);
await writeFile(
  outputPath,
  `${JSON.stringify(reconciliation, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ output: outputPath, ...result }, null, 2));
