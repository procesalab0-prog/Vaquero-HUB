#!/usr/bin/env node
import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  analyzeRows,
  canonicalHeaders,
  compareRows,
  rowFromValues,
  sha256File,
  SICAR_COLUMNS,
} from "./sicar/analyzer.mjs";

function usage() {
  console.error(
    "Uso: pnpm sicar:analyze -- <actual.xlsx> [--previous anterior.xlsx] [--output reporte.json]",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
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

async function load(path) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`EMPTY_WORKBOOK: ${path}`);
  const headers = canonicalHeaders(sheet.getRow(1).values.slice(1));
  const missing = SICAR_COLUMNS.map(([source]) => source).filter(
    (header) => !headers.includes(header),
  );
  if (missing.length) throw new Error(`MISSING_COLUMNS: ${missing.join(", ")}`);
  const rows = [];
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const values = sheet.getRow(index).values.slice(1);
    if (values.every((value) => value == null || String(value).trim() === ""))
      continue;
    rows.push(rowFromValues(headers, values, index));
  }
  return { rows, sheet: sheet.name, sha256: await sha256File(path) };
}

const current = await load(currentPath);
const previous = previousPath ? await load(previousPath) : null;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: "DRY_RUN_READ_ONLY",
  source: {
    file: basename(currentPath),
    sheet: current.sheet,
    sha256: current.sha256,
  },
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
  current: analyzeRows(current.rows),
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
