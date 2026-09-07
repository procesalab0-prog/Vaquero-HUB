#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { analyzeRows, compareRows, SICAR_COLUMNS } from "./sicar/analyzer.mjs";
import { loadSicarWorkbook } from "./sicar/workbook.mjs";

function usage() {
  console.error(
    "Uso: pnpm sicar:analyze -- <actual.xlsx> [--previous anterior.xlsx] [--output reporte.json] [--physical-barcode-verified evidencia --symbology CODE128]",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
if (!args.length || args.includes("--help")) usage();
const currentPath = resolve(args[0]);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const previousPath = option("--previous")
  ? resolve(option("--previous"))
  : null;
const outputPath = resolve(
  option("--output") ??
    `sicar-dry-run-${new Date().toISOString().slice(0, 10)}.json`,
);

const barcodeTestReference = option("--physical-barcode-verified") ?? null;
const barcodeSymbology = option("--symbology")?.toUpperCase() ?? null;
if (Boolean(barcodeTestReference) !== Boolean(barcodeSymbology)) {
  throw new Error("BARCODE_VERIFICATION_REQUIRES_REFERENCE_AND_SYMBOLOGY");
}
if (
  barcodeSymbology &&
  !["EAN13", "CODE128", "LEGACY"].includes(barcodeSymbology)
) {
  throw new Error("INVALID_BARCODE_SYMBOLOGY");
}

const current = await loadSicarWorkbook(currentPath);
const previous = previousPath ? await loadSicarWorkbook(previousPath) : null;
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  mode: "DRY_RUN_READ_ONLY",
  source: {
    file: basename(currentPath),
    sheet: current.sheet,
    sha256: current.sha256,
  },
  barcodeVerification: barcodeTestReference
    ? {
        verified: true,
        reference: barcodeTestReference,
        symbology: barcodeSymbology,
      }
    : { verified: false, reference: null, symbology: null },
  previousSource: previous
    ? {
        file: basename(previousPath),
        sheet: previous.sheet,
        sha256: previous.sha256,
      }
    : null,
  mapping: SICAR_COLUMNS.map(([source, target, rule]) => ({
    source,
    target,
    rule,
  })),
  current: analyzeRows(current.rows, {
    physicalBarcodeVerified: Boolean(barcodeTestReference),
  }),
  comparison: previous ? compareRows(previous.rows, current.rows) : null,
  guarantees: {
    writesDatabase: false,
    mutatesSicar: false,
    infersMovementCause: false,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      output: outputPath,
      rows: report.current.rows,
      uniqueKeys: report.current.uniqueKeys,
      errors: report.current.exceptions.filter(
        (item) => item.severity === "error",
      ).length,
      warnings: report.current.exceptions.filter(
        (item) => item.severity === "warning",
      ).length,
      comparison: report.comparison?.summary ?? null,
      gates: report.current.gates,
    },
    null,
    2,
  ),
);
