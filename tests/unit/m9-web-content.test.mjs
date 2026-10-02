import { describe, it, expect } from "vitest";
import { prepareWebContent } from "../../scripts/m9/prepare-web-content.mjs";
const row = {
  barcode: "0001",
  price_cents: 12345,
  woo_product_id: 7,
  woo_variation_id: 8,
  attributes: { TALLA: "27" },
  department: "CABALLERO",
  section: "BOTAS",
};
const source = () => ({
  pagination_complete: true,
  products: [
    {
      id: 7,
      type: "variable",
      status: "publish",
      name: "Bota",
      description: "<p>Original</p>",
      short_description: "BASE",
      images: "https://example.com/foto.jpg",
      categories: "Caballero > Botas",
      variations: [
        {
          id: 8,
          status: "publish",
          attributes: [{ name: "Talla", option: "27" }],
          price: "123.45",
          sale_price: "100",
        },
        { id: 9, status: "publish" },
      ],
    },
  ],
});
describe("contenido web de sólo lectura", () => {
  it("reutiliza ID, conserva ceros, promociones y variantes ajenas al piloto", () => {
    const packet = prepareWebContent([row], source());
    const p = packet.products[0];
    expect(p.create_new_parent).toBe(false);
    expect(p.unselected_woo_variation_ids).toEqual([9]);
    expect(p.variants[0].barcode).toBe("0001");
    expect(p.variants[0].retail_from_sicar).toBe("123.45");
    expect(p.variants[0].sale_price_woo).toBe("100");
    expect(p.category_ids).toBe(null);
    expect(p.description_html).toBe("<p>Original</p>");
    expect(packet.woo_writes_enabled).toBe(false);
    expect(JSON.stringify(packet)).not.toContain("stock_quantity");
  });
  it("detiene relaciones ausentes y duplicadas", () => {
    expect(() =>
      prepareWebContent([{ ...row, woo_variation_id: 77 }], source()),
    ).toThrow("WOO_VARIATION");
    expect(() => prepareWebContent([row, row], source())).toThrow(
      "DUPLICATE_BARCODE",
    );
    expect(() =>
      prepareWebContent([row, { ...row, barcode: "2" }], source()),
    ).toThrow("DUPLICATE_WOO_VARIATION");
  });
  it("reporta faltantes sin inventar contenido", () => {
    const woo = source();
    woo.products[0].description = "";
    woo.products[0].images = "";
    expect(prepareWebContent([row], woo).products[0].issues).toEqual([
      "CATEGORY_IDS_REQUIRE_VERIFIED_MAPPING",
      "MISSING_IMAGES",
      "MISSING_LONG_DESCRIPTION",
    ]);
  });
  it("rechaza fuentes incompletas, padres duplicados y precios fraccionarios", () => {
    expect(() =>
      prepareWebContent([row], { ...source(), pagination_complete: false }),
    ).toThrow("INCOMPLETE");
    const woo = source();
    woo.products.push(woo.products[0]);
    expect(() => prepareWebContent([row], woo)).toThrow("DUPLICATE_WOO_PARENT");
    expect(() =>
      prepareWebContent([{ ...row, price_cents: 12.5 }], source()),
    ).toThrow("INVALID_RETAIL");
  });
});
