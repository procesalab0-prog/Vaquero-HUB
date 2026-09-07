import { describe, expect, it } from "vitest";
import {
  analyzeRows,
  canonicalHeaders,
  compareRows,
  decimalToCents,
  rowFromValues,
} from "../../scripts/sicar/analyzer.mjs";
import {
  assertApprovedReport,
  assertStagingUrl,
  catalogRow,
} from "../../scripts/sicar/sync.mjs";

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
      gates: {
        canWriteStaging: boolean;
        canWriteCatalogStaging: boolean;
        canWriteProduction: boolean;
      };
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
    expect(report.gates.canWriteCatalogStaging).toBe(false);
    expect(report.gates.canWriteProduction).toBe(false);
  });

  it("permite catálogo limpio aunque el saldo negativo siga bloqueado para existencias", () => {
    const report = analyzeRows(
      [
        row(
          [
            "000007779",
            "",
            "Bota 25",
            "CABALLERO",
            "BOTAS",
            "PIEZA",
            500,
            1200,
            -1,
            "n",
          ],
          2,
        ),
      ],
      { physicalBarcodeVerified: true },
    ) as {
      gates: { canWriteStaging: boolean; canWriteCatalogStaging: boolean };
    };
    expect(report.gates.canWriteStaging).toBe(false);
    expect(report.gates.canWriteCatalogStaging).toBe(true);
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

describe("sincronizador de catálogo SICAR", () => {
  it("preserva la clave con cero inicial y convierte dinero a centavos", () => {
    const converted = catalogRow({
      _row: 8,
      clave1: "000007779",
      descripcion: "Bota",
      caracteristicas: "Piel",
      departamento: "CABALLERO",
      categoria: "BOTAS",
      costo: "1,250.50",
      precio1: "2,900",
      mostrar_ventas: "s",
    });
    expect(converted).toMatchObject({
      row_number: 8,
      legacy_key: "000007779",
      cost_cents: 125050,
      price_cents: 290000,
      is_active: true,
    });
    expect(converted.row_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(decimalToCents("10.01")).toBe(1001);
  });

  it("rechaza reportes, archivos o destinos no aprobados", () => {
    const report = {
      schemaVersion: 2,
      mode: "DRY_RUN_READ_ONLY",
      source: { sha256: "a".repeat(64) },
      current: { gates: { canWriteCatalogStaging: true } },
      barcodeVerification: {
        verified: true,
        reference: "Etiqueta física 001",
        symbology: "CODE128",
      },
    };
    expect(() =>
      assertApprovedReport({
        report,
        workbookSha: "a".repeat(64),
        confirmSha: "b".repeat(64),
      }),
    ).toThrow("SICAR_SHA_MISMATCH");
    expect(() =>
      assertStagingUrl("https://drubkjlmfbdeglucakmg.supabase.co"),
    ).toThrow("SICAR_SYNC_REFUSES_NON_STAGING_PROJECT");
    expect(() =>
      assertStagingUrl("https://zsezjtswqeijboezvado.supabase.co"),
    ).not.toThrow();
  });
});
