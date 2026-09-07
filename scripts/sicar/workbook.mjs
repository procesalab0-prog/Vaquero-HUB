import ExcelJS from "exceljs";

import {
  canonicalHeaders,
  rowFromValues,
  sha256File,
  SICAR_COLUMNS,
} from "./analyzer.mjs";

export async function loadSicarWorkbook(path) {
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
