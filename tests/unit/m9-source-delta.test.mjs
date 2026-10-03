import { describe, it, expect } from "vitest";
import { sourceDelta } from "../../scripts/m9/prepare-source-delta.mjs";
const row = (barcode = "0001", price = "820") => ({
  barcode,
  description: "Camisa",
  fields: { "clave1 *": barcode, precio1: price, existencia: "4" },
  classification: "MATCH_EXACT_VARIANT",
  manual_review: false,
  product_id: 10,
  variation_id: 11,
  attributes: [{ name: "Talla", value: "XXL" }],
  issues: [],
  commercial_checks: [],
});
describe("source cut comparison", () => {
  it("retains exact barcodes, never infers deletion, and quarantines duplicates", () => {
    const r = sourceDelta(
      [row(), row("0002"), row("0003")],
      [row(), row("0003"), row("0003"), row("0004")],
    );
    expect(r.items.map((x) => [x.barcode, x.state])).toEqual([
      ["0001", "UNCHANGED"],
      ["0002", "ABSENT_MANUAL_REVIEW_NO_DELETE"],
      ["0003", "DUPLICATE_MANUAL_REVIEW"],
      ["0004", "NEW_MANUAL_REVIEW"],
    ]);
    expect(r.absence_means_deletion).toBe(false);
    expect(r.automatic_import_allowed).toBe(false);
  });
  it("separates a real public price change from decimal formatting", () => {
    expect(sourceDelta([row()], [row("0001", "821")]).items[0].state).toBe(
      "PUBLIC_PRICE_CHANGE_REVIEW",
    );
    expect(sourceDelta([row()], [row("0001", "820.00")]).items[0].state).toBe(
      "PRICE_FORMAT_ONLY",
    );
    expect(sourceDelta([row()], [row("0001", "0")]).items[0].state).toBe(
      "INVALID_PUBLIC_PRICE_REVIEW",
    );
  });
  it("does not turn stock changes into catalog changes or copy quantities", () => {
    const b = row();
    b.fields.existencia = "399";
    const r = sourceDelta([row()], [b]);
    expect(r.items[0].state).toBe("INVENTORY_ONLY_EXCLUDED");
    expect(JSON.stringify(r)).not.toContain("399");
    expect(r.inventory_included).toBe(false);
  });
  it("separates changed matching rules from a physical source change", () => {
    const b = row();
    b.variation_id = 22;
    b.attributes[0].value = "2XL";
    const r = sourceDelta([row()], [b]);
    expect(r.items[0].state).toBe("RECONCILIATION_CHANGE_ONLY");
    expect(r.items[0].changes).toEqual({});
    expect(r.reconciliation_changes).toBe(1);
  });
  it("does not hide other changes when the price changes", () => {
    const b = row("0001", "821");
    b.fields.categoria = "Otra";
    expect(sourceDelta([row()], [b]).items[0].state).toBe(
      "CATALOG_CHANGE_MANUAL_REVIEW",
    );
  });
});
