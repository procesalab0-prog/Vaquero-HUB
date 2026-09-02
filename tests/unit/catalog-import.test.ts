import { describe, expect, it } from "vitest";

import { parseCsv } from "../../lib/catalog-import-shared";

const headers =
  "producto,categoria,marca,descripcion,color,talla,costo,precio,codigo";

describe("plantilla de carga masiva", () => {
  it("conserva códigos y espacios para que PostgreSQL pueda reportarlos", () => {
    const parsed = parseCsv(
      `${headers}\r\n"Bota, bordada",Botas,Cuadra,,Negro,25,1200.50,2199,0012345678901\r\n`,
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      product_name: "Bota, bordada",
      cost: "1200.50",
      barcode: "0012345678901",
      barcode_was_numeric: false,
    });
  });

  it("acepta el separador de Excel en español", () => {
    const parsed = parseCsv(
      `${headers.replaceAll(",", ";")}\nBota;Botas;;;Negro;25;1200;2199;ABC-01\n`,
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0].barcode).toBe("ABC-01");
  });

  it("rechaza columnas ajenas o incompletas antes de enviar datos", () => {
    const parsed = parseCsv(
      "producto,categoria,color,talla,costo,codigo,legacy_sicar_code\nBota,Botas,Negro,25,100,ABC,SICAR-1",
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["COLUMNA_DESCONOCIDA", "COLUMNA_FALTANTE"]),
    );
  });
});
