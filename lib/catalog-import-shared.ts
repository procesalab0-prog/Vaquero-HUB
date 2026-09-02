export const catalogImportHeaders = [
  "producto",
  "categoria",
  "marca",
  "descripcion",
  "color",
  "talla",
  "costo",
  "precio",
  "codigo",
] as const;

export type CatalogImportRow = {
  product_name: string;
  category: string;
  brand: string;
  description: string;
  color: string;
  size: string;
  cost: string;
  price: string;
  barcode: string;
  barcode_was_numeric: boolean;
};

export type CatalogImportIssue = {
  row: number;
  field: string;
  code: string;
  message: string;
};

export type CatalogImportState = {
  phase: "idle" | "preview" | "committed" | "error";
  message?: string;
  totalRows?: number;
  validRows?: number;
  errorCount?: number;
  productCount?: number;
  variantCount?: number;
  errors?: CatalogImportIssue[];
  payload?: string;
};

export const initialCatalogImportState: CatalogImportState = { phase: "idle" };

type ImportCell = { text: string; numeric: boolean; invalid?: boolean };
const headerToField: Record<
  string,
  keyof Omit<CatalogImportRow, "barcode_was_numeric">
> = {
  producto: "product_name",
  categoria: "category",
  marca: "brand",
  descripcion: "description",
  color: "color",
  talla: "size",
  costo: "cost",
  precio: "price",
  codigo: "barcode",
};
const requiredHeaders = [
  "producto",
  "categoria",
  "color",
  "talla",
  "costo",
  "precio",
  "codigo",
];

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("es-MX")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function emptyRow(): CatalogImportRow {
  return {
    product_name: "",
    category: "",
    brand: "",
    description: "",
    color: "",
    size: "",
    cost: "",
    price: "",
    barcode: "",
    barcode_was_numeric: false,
  };
}

export function mapCatalogImportRows(headers: string[], cells: ImportCell[][]) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const issues: CatalogImportIssue[] = [];
  const duplicates = normalizedHeaders.filter(
    (header, index) => header && normalizedHeaders.indexOf(header) !== index,
  );
  const unknown = normalizedHeaders.filter(
    (header) => header && !(header in headerToField),
  );
  const missing = requiredHeaders.filter(
    (header) => !normalizedHeaders.includes(header),
  );

  for (const header of new Set(duplicates)) {
    issues.push({
      row: 1,
      field: header,
      code: "COLUMNA_DUPLICADA",
      message: `La columna “${header}” aparece más de una vez.`,
    });
  }
  for (const header of new Set(unknown)) {
    issues.push({
      row: 1,
      field: header,
      code: "COLUMNA_DESCONOCIDA",
      message: `La columna “${header}” no pertenece a la plantilla de Mi Tienda SM.`,
    });
  }
  for (const header of missing) {
    issues.push({
      row: 1,
      field: header,
      code: "COLUMNA_FALTANTE",
      message: `Falta la columna obligatoria “${header}”.`,
    });
  }
  if (issues.length) return { rows: [] as CatalogImportRow[], issues };

  const rows: CatalogImportRow[] = [];
  cells.forEach((source, rowIndex) => {
    if (source.every((cell) => !cell.text.trim())) return;
    const row = emptyRow();
    normalizedHeaders.forEach((header, columnIndex) => {
      const field = headerToField[header];
      const cell = source[columnIndex] ?? { text: "", numeric: false };
      if (!field) return;
      row[field] = cell.text;
      if (field === "barcode") row.barcode_was_numeric = cell.numeric;
      if (cell.invalid) {
        issues.push({
          row: rowIndex + 2,
          field: header,
          code: "CELDA_NO_ADMITIDA",
          message:
            "Usa texto o número simple; no se admiten fórmulas, fechas ni errores.",
        });
      }
    });
    rows.push(row);
  });
  return { rows, issues };
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (delimiter: string) => {
    let quoted = false;
    let found = 0;
    for (let index = 0; index < firstLine.length; index += 1) {
      if (firstLine[index] === '"') quoted = !quoted;
      if (!quoted && firstLine[index] === delimiter) found += 1;
    }
    return found;
  };
  return count(";") > count(",") ? ";" : ",";
}

export function parseCsv(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(source);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV_COMILLAS_SIN_CERRAR");
  if (cell || row.length) {
    row.push(cell);
    records.push(row);
  }
  const headers = records.shift() ?? [];
  return mapCatalogImportRows(
    headers,
    records.map((record) =>
      record.map((value) => ({ text: value, numeric: false })),
    ),
  );
}
