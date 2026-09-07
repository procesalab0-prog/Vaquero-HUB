import { describe, expect, it } from "vitest";
import {
  analyzeRows,
  canonicalHeaders,
  compareRows,
  rowFromValues,
} from "../../scripts/sicar/analyzer.mjs";

const headers = [
  "clave1",
  "clave2",
  "descripcion",
  "departamento",
  "categoria",
  "unidad",
  "costo",
  "precio1",
  "existencia",
  "granel",
];

function row(values: unknown[], number: number) {
  return rowFromValues(headers, values, number);
}

describe("analizador de exportaciones SICAR", () => {
  it("preserva claves con ceros y bloquea saldos negativos", () => {
    const report = analyzeRows([
      row(
        [
          "000007779",
          "",
          "Bota 25",
          "CABALLERO",
          "BOTAS",
          "PIEZA",
          0,
          1200,
          -1,
          "n",
        ],
        2,
      ),
    ]) as {
      leadingZeroKeys: number;
      stock: { total: number; negativeRows: number };
      exceptions: Array<{ code: string; severity: string }>;
      gates: { canWriteStaging: boolean; canWriteProduction: boolean };
    };

    expect(report.leadingZeroKeys).toBe(1);
    expect(report.stock).toMatchObject({ total: -1, negativeRows: 1 });
    expect(report.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NEGATIVE_STOCK", severity: "error" }),
        expect.objectContaining({ code: "ZERO_COST", severity: "warning" }),
      ]),
    );
    expect(report.gates.canWriteStaging).toBe(false);
    expect(report.gates.canWriteProduction).toBe(false);
  });

  it("clasifica altas, ausencias, cambios y deltas sin inventar la causa", () => {
    const previous = [
      row(
        ["1", "", "Bota", "CABALLERO", "BOTAS", "PIEZA", 500, 1000, 2, "n"],
        2,
      ),
      row(
        ["2", "", "Cinto", "CABALLERO", "CINTOS", "PIEZA", 100, 200, 1, "n"],
        3,
      ),
    ];
    const current = [
      row(
        [
          "1",
          "",
          "Bota nueva",
          "CABALLERO",
          "BOTAS",
          "PIEZA",
          500,
          1100,
          1,
          "n",
        ],
        2,
      ),
      row(
        ["3", "", "Sombrero", "UNISEX", "SOMBREROS", "PIEZA", 300, 700, 4, "n"],
        3,
      ),
    ];
    const comparison = compareRows(previous, current) as {
      summary: Record<string, number>;
      stockChanges: Array<{ inferredCause: null }>;
      warning: string;
    };

    expect(comparison.summary).toMatchObject({
      added: 1,
      absent: 1,
      changedCatalog: 1,
      changedStock: 1,
      stockDecrease: -1,
      stockIncrease: 0,
    });
    expect(comparison.stockChanges[0]?.inferredCause).toBeNull();
    expect(comparison.warning).toContain("no demuestran ventas");
  });

  it("normaliza exactamente los encabezados reales de la plantilla", () => {
    expect(
      canonicalHeaders([
        "clave1 *",
        "descripción *",
        "(s/n) inventariable",
        "(s/n) imp IVA (16%)",
        "localización 1",
      ]),
    ).toEqual([
      "clave1",
      "descripcion",
      "inventariable",
      "iva_16",
      "localizacion_1",
    ]);
  });
});
