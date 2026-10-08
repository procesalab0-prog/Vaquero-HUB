import { describe, expect, it } from "vitest";
import { posScanError } from "../../lib/pos-scan";

describe("códigos exactos del lector", () => {
  it("distingue un código inexistente de uno ambiguo", () => {
    expect(posScanError("SCAN_NOT_FOUND")).toContain("No encontramos");
    expect(posScanError("SCAN_AMBIGUOUS")).toContain("ambiguo");
  });
  it("explica falta de stock y no filtra mensajes internos", () => {
    expect(posScanError("SCAN_NOT_AVAILABLE")).toContain("existencia");
    expect(posScanError("private sql error")).not.toContain("private sql");
  });
});
