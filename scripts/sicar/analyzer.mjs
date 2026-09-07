import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const SICAR_COLUMNS = [
  ["clave1", "legacy_sicar_code", "Identidad heredada; conservar como texto"],
  ["clave2", "barcode_candidate", "Candidato; requiere comprobación física"],
  [
    "descripcion",
    "variant_description",
    "Fuente provisional de producto y atributos",
  ],
  ["caracteristicas", "notes", "Dato descriptivo opcional"],
  ["departamento", "department_name", "Catálogo de departamentos"],
  ["categoria", "category_name", "Catálogo de categorías"],
  [
    "inventariable",
    "is_inventory_tracked",
    "Debe ser verdadero para inventario",
  ],
  ["receta", null, "No aplica al giro; conservar sólo en fotografía"],
  ["lotes", null, "No aplica al giro; conservar sólo en fotografía"],
  ["unidad", "unit", "Se espera PIEZA"],
  ["peso_automatico", null, "No aplica a productos por pieza"],
  ["favorito", null, "Preferencia de SICAR; no migrar"],
  ["clave_sat", "sat_code", "Metadato fiscal opcional"],
  ["costo", "cost", "Nunca reemplazar cero sin decisión"],
  ["precio1", "retail_price", "Precio operativo"],
  ["precio2", "price_level_2", "Escala opcional"],
  ["precio3", "price_level_3", "Escala opcional"],
  ["precio4", "price_level_4", "Escala opcional"],
  ["mayoreo2", "wholesale_threshold_2", "Requiere regla comercial"],
  ["mayoreo3", "wholesale_threshold_3", "Requiere regla comercial"],
  ["mayoreo4", "wholesale_threshold_4", "Requiere regla comercial"],
  ["precio_con_impuestos", "price_includes_tax", "Metadato fiscal"],
  ["iva_16", "tax_rate", "Metadato fiscal"],
  ["granel", "is_bulk", "Debe ser falso para cantidades enteras"],
  ["existencia", "source_quantity", "Sólo modo existencias; nunca catálogo"],
  ["inv_min", "minimum_quantity", "Nivel mínimo opcional"],
  ["inv_max", "maximum_quantity", "Nivel máximo opcional"],
  ["mostrar_sicar_shop", null, "Preferencia de SICAR; no migrar"],
  ["mostrar_ventas", "is_active", "Visibilidad operativa"],
  ["localizacion_1", null, "No distribuir si está vacío"],
  ["localizacion_2", null, "No distribuir si está vacío"],
  ["localizacion_3", null, "No distribuir si está vacío"],
];

const HEADER_ALIASES = new Map([
  ["clave1", "clave1"],
  ["clave2", "clave2"],
  ["descripcion", "descripcion"],
  ["caracteristicas", "caracteristicas"],
  ["departamento", "departamento"],
  ["categoria", "categoria"],
  ["sn inventariable", "inventariable"],
  ["sn receta", "receta"],
  ["sn lotes", "lotes"],
  ["unidad", "unidad"],
  ["sn peso automatico", "peso_automatico"],
  ["sn favorito", "favorito"],
  ["clave sat", "clave_sat"],
  ["costo", "costo"],
  ["precio1", "precio1"],
  ["precio2", "precio2"],
  ["precio3", "precio3"],
  ["precio4", "precio4"],
  ["mayoreo2", "mayoreo2"],
  ["mayoreo3", "mayoreo3"],
  ["mayoreo4", "mayoreo4"],
  ["sn precio con impuestos", "precio_con_impuestos"],
  ["sn imp iva 16", "iva_16"],
  ["sn granel", "granel"],
  ["existencia", "existencia"],
  ["inv_min", "inv_min"],
  ["inv_max", "inv_max"],
  ["sn mostrar en sicarshop", "mostrar_sicar_shop"],
  ["sn mostrar en ventas", "mostrar_ventas"],
  ["localizacion 1", "localizacion_1"],
  ["localizacion 2", "localizacion_2"],
  ["localizacion 3", "localizacion_3"],
]);

const COMPARABLE_FIELDS = [
  "clave2",
  "descripcion",
  "caracteristicas",
  "departamento",
  "categoria",
  "unidad",
  "clave_sat",
  "costo",
  "precio1",
  "precio2",
  "precio3",
  "precio4",
  "mayoreo2",
  "mayoreo3",
  "mayoreo4",
  "inv_min",
  "inv_max",
  "mostrar_ventas",
];

function plain(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("result" in value) return plain(value.result);
    if ("text" in value) return plain(value.text);
    if (Array.isArray(value.richText))
      return value.richText.map((part) => part.text).join("");
  }
  return String(value).trim();
}

export function normalizeHeader(value) {
  return plain(value)
    .replace(/\(s\/n\)/gi, "sn")
    .toLocaleLowerCase("es-MX")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\*/g, "")
    .replace(/[()%]/g, " ")
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();
}

export function canonicalHeaders(values) {
  return values.map(
    (value) =>
      HEADER_ALIASES.get(normalizeHeader(value)) ?? normalizeHeader(value),
  );
}

export function rowFromValues(headers, values, rowNumber) {
  return Object.fromEntries([
    ["_row", rowNumber],
    ...headers.map((header, index) => [header, plain(values[index])]),
  ]);
}

export function parseDecimal(value) {
  const normalized = plain(value).replace(/\s/g, "").replace(/,/g, "");
  if (!normalized) return 0;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : Number.NaN;
}

function fingerprint(row) {
  return Object.fromEntries(
    COMPARABLE_FIELDS.map((field) => [field, row[field] ?? ""]),
  );
}

function exception(code, severity, row, detail) {
  return { code, severity, row: row._row, key: row.clave1 || null, detail };
}

export function analyzeRows(rows, { physicalBarcodeVerified = false } = {}) {
  const exceptions = [];
  const keyCounts = new Map();
  const departments = new Map();
  const categories = new Map();
  let stock = 0;
  let costValue = 0;
  let positiveStockRows = 0;
  let zeroStockRows = 0;
  let negativeStockRows = 0;
  let zeroCostRows = 0;
  let zeroPriceRows = 0;

  for (const row of rows) {
    const key = row.clave1;
    if (!key)
      exceptions.push(
        exception("MISSING_KEY", "error", row, "clave1 está vacía"),
      );
    else keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    if (key && !/^\d+$/.test(key))
      exceptions.push(
        exception("NON_NUMERIC_KEY", "error", row, "clave1 no es numérica"),
      );
    if (!row.descripcion)
      exceptions.push(
        exception("MISSING_DESCRIPTION", "error", row, "descripción vacía"),
      );

    const quantity = parseDecimal(row.existencia);
    const cost = parseDecimal(row.costo);
    const price = parseDecimal(row.precio1);
    if (!Number.isInteger(quantity))
      exceptions.push(
        exception(
          "NON_INTEGER_STOCK",
          "error",
          row,
          `existencia=${row.existencia}`,
        ),
      );
    if (!Number.isFinite(quantity))
      exceptions.push(
        exception(
          "INVALID_STOCK",
          "error",
          row,
          `existencia=${row.existencia}`,
        ),
      );
    else {
      stock += quantity;
      costValue += quantity * (Number.isFinite(cost) ? cost : 0);
      if (quantity > 0) positiveStockRows += 1;
      else if (quantity < 0) {
        negativeStockRows += 1;
        exceptions.push(
          exception("NEGATIVE_STOCK", "error", row, `existencia=${quantity}`),
        );
      } else zeroStockRows += 1;
    }
    if (!Number.isFinite(cost))
      exceptions.push(
        exception("INVALID_COST", "error", row, `costo=${row.costo}`),
      );
    else if (cost === 0) {
      zeroCostRows += 1;
      exceptions.push(exception("ZERO_COST", "warning", row, "costo=0"));
    }
    if (!Number.isFinite(price) || price <= 0) {
      zeroPriceRows += 1;
      exceptions.push(
        exception(
          "INVALID_RETAIL_PRICE",
          "error",
          row,
          `precio1=${row.precio1}`,
        ),
      );
    }
    if (row.unidad.toLocaleUpperCase("es-MX") !== "PIEZA")
      exceptions.push(
        exception("UNEXPECTED_UNIT", "error", row, `unidad=${row.unidad}`),
      );
    if (row.granel.toLocaleLowerCase("es-MX") === "s")
      exceptions.push(
        exception("BULK_PRODUCT", "error", row, "producto marcado a granel"),
      );
    if (row.departamento)
      departments.set(
        row.departamento,
        (departments.get(row.departamento) ?? 0) + 1,
      );
    if (row.categoria)
      categories.set(row.categoria, (categories.get(row.categoria) ?? 0) + 1);
  }

  for (const row of rows) {
    if (row.clave1 && (keyCounts.get(row.clave1) ?? 0) > 1) {
      exceptions.push(
        exception(
          "DUPLICATE_KEY",
          "error",
          row,
          `clave1 aparece ${keyCounts.get(row.clave1)} veces`,
        ),
      );
    }
  }

  const errors = exceptions.filter((item) => item.severity === "error").length;
  return {
    rows: rows.length,
    uniqueKeys: keyCounts.size,
    leadingZeroKeys: [...keyCounts.keys()].filter((key) => /^0\d+/.test(key))
      .length,
    stock: {
      total: stock,
      positiveRows: positiveStockRows,
      zeroRows: zeroStockRows,
      negativeRows: negativeStockRows,
    },
    costs: {
      zeroRows: zeroCostRows,
      sourceValue: Math.round(costValue * 100) / 100,
    },
    prices: { invalidOrZeroRows: zeroPriceRows },
    departments: Object.fromEntries(
      [...departments].sort((a, b) => b[1] - a[1]),
    ),
    categoryCount: categories.size,
    exceptions,
    gates: {
      physicalBarcodeVerified,
      canWriteStaging: errors === 0 && physicalBarcodeVerified,
      canWriteProduction: false,
      reason:
        errors > 0
          ? `${errors} errores requieren clasificación o corrección`
          : physicalBarcodeVerified
            ? "La corrida en seco está limpia; producción sigue bloqueada"
            : "Falta verificar físicamente clave1 y la simbología",
    },
  };
}

export function compareRows(previousRows, currentRows) {
  const previous = new Map(
    previousRows.filter((row) => row.clave1).map((row) => [row.clave1, row]),
  );
  const current = new Map(
    currentRows.filter((row) => row.clave1).map((row) => [row.clave1, row]),
  );
  const added = [],
    absent = [],
    changed = [],
    stockChanges = [];
  for (const [key, row] of current) {
    const before = previous.get(key);
    if (!before) {
      added.push(key);
      continue;
    }
    const fields = COMPARABLE_FIELDS.filter(
      (field) => (before[field] ?? "") !== (row[field] ?? ""),
    );
    if (fields.length)
      changed.push({
        key,
        fields,
        before: fingerprint(before),
        after: fingerprint(row),
      });
    const delta =
      parseDecimal(row.existencia) - parseDecimal(before.existencia);
    if (delta !== 0)
      stockChanges.push({
        key,
        before: parseDecimal(before.existencia),
        after: parseDecimal(row.existencia),
        delta,
        inferredCause: null,
      });
  }
  for (const key of previous.keys()) if (!current.has(key)) absent.push(key);
  return {
    addedKeys: added,
    absentKeys: absent,
    changedCatalogRows: changed,
    stockChanges,
    summary: {
      added: added.length,
      absent: absent.length,
      changedCatalog: changed.length,
      changedStock: stockChanges.length,
      stockDecrease: stockChanges
        .filter((item) => item.delta < 0)
        .reduce((sum, item) => sum + item.delta, 0),
      stockIncrease: stockChanges
        .filter((item) => item.delta > 0)
        .reduce((sum, item) => sum + item.delta, 0),
    },
    warning:
      "Los deltas no demuestran ventas, devoluciones, ajustes ni traspasos.",
  };
}

export async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
