import { describe, expect, it } from "vitest";
import { posScanError } from "../../lib/pos-scan";

describe("códigos exactos del lector", () => {
  it("distingue un código inexistente de uno ambiguo", () => {
    expect(posScanError("SCAN_NOT_FOUND")).toContain("No encontramos");
    expect(posScanError("SCAN_AMBIGUOUS")).toContain("ambiguo");
  });
  it("explica retenciones de migración sin confundirlas con falta de stock", () => {
    expect(posScanError("M9_VARIANT_PENDING_REVIEW")).toContain("pendiente de revisión");
    expect(posScanError("M9_VARIANT_REVIEW_CHANGED")).toContain("pendiente de revisión");
    expect(posScanError("M9_REVIEW_EXPIRED")).toContain("venció");
  });
  it("explica falta de stock y no filtra mensajes internos", () => {
    expect(posScanError("SCAN_NOT_AVAILABLE")).toContain("existencia");
    expect(posScanError("private sql error")).not.toContain("private sql");
  });
});
