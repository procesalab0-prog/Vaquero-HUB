import "server-only";

import ExcelJS from "exceljs";
import { mapCatalogImportRows, parseCsv } from "@/lib/catalog-import-shared";

const maxFileBytes = 1024 * 1024;
const maxRows = 1000;
const maxExpandedXlsxBytes = 20 * 1024 * 1024;
const maxXlsxEntries = 200;

function verifyXlsxArchive(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("XLSX_INVALIDO");

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  let offset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount < 1 || entryCount > maxXlsxEntries)
    throw new Error("XLSX_DEMASIADAS_PARTES");
  if (offset + centralSize > buffer.length) throw new Error("XLSX_INVALIDO");

  let expandedBytes = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== 0x02014b50
    )
      throw new Error("XLSX_INVALIDO");
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    if (size === 0xffffffff) throw new Error("XLSX_ZIP64_NO_ADMITIDO");
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw new Error("XLSX_INVALIDO");
    const name = buffer.toString("utf8", nameStart, nameEnd);
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..")
    )
      throw new Error("XLSX_RUTA_INVALIDA");
    expandedBytes += size;
    if (expandedBytes > maxExpandedXlsxBytes)
      throw new Error("XLSX_EXPANSION_DEMASIADO_GRANDE");
    offset = nameEnd + extraLength + commentLength;
  }
}

function xlsxCell(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value === null || value === undefined)
    return { text: "", numeric: false };
  if (typeof value === "string") return { text: value, numeric: false };
  if (typeof value === "number") return { text: String(value), numeric: true };
  if (typeof value === "boolean")
    return { text: String(value), numeric: false, invalid: true };
  if (typeof value === "object" && "richText" in value) {
    return {
      text: value.richText.map((part) => part.text).join(""),
      numeric: false,
    };
  }
  return { text: cell.text, numeric: false, invalid: true };
}

async function parseXlsx(buffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  const source = Buffer.from(buffer);
  verifyXlsxArchive(source);
  const input = source as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(input);
  const worksheet =
    workbook.getWorksheet("Importacion") ?? workbook.worksheets[0];
  if (!worksheet) throw new Error("XLSX_SIN_HOJA");
  if (worksheet.actualColumnCount > 50)
    throw new Error("XLSX_DEMASIADAS_COLUMNAS");
  if (worksheet.actualRowCount > maxRows + 1)
    throw new Error("DEMASIADAS_FILAS");
  const headerRow = worksheet.getRow(1);
  const headers = Array.from(
    { length: worksheet.actualColumnCount },
    (_, index) => headerRow.getCell(index + 1).text,
  );
  const rows = Array.from(
    { length: Math.max(worksheet.actualRowCount - 1, 0) },
    (_, index) => {
      const source = worksheet.getRow(index + 2);
      return Array.from({ length: headers.length }, (__, columnIndex) =>
        xlsxCell(source.getCell(columnIndex + 1)),
      );
    },
  );
  return mapCatalogImportRows(headers, rows);
}

export async function parseCatalogImportFile(file: File) {
  if (!file.name || file.size === 0) throw new Error("ARCHIVO_VACIO");
  if (file.size > maxFileBytes) throw new Error("ARCHIVO_DEMASIADO_GRANDE");
  const lowerName = file.name.toLocaleLowerCase("es-MX");
  const parsed = lowerName.endsWith(".csv")
    ? parseCsv(await file.text())
    : lowerName.endsWith(".xlsx")
      ? await parseXlsx(await file.arrayBuffer())
      : (() => {
          throw new Error("FORMATO_NO_ADMITIDO");
        })();
  if (parsed.rows.length < 1 && parsed.issues.length === 0)
    throw new Error("ARCHIVO_SIN_DATOS");
  if (parsed.rows.length > maxRows) throw new Error("DEMASIADAS_FILAS");
  return parsed;
}
