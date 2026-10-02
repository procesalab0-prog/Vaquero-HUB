import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MigrationReview } from "../../app/(workspace)/productos/migracion/review";
import { reviewFilters, type ReviewData } from "../../lib/m9-review";

const data: ReviewData = {
  page: 1,
  page_size: 20,
  total: 1,
  can_view_cost: true,
  departments: ["JUVENIL"],
  sections: ["BOTAS"],
  rows: [
    {
      id: "fixture",
      name: "Producto de prueba",
      barcode: "0001",
      sku: "SKU-PRUEBA",
      department: "JUVENIL",
      section: "BOTAS",
      source_description: "BASE25.5",
      price_cents: 91000,
      cost_cents: null,
      wholesale_cents: null,
      medium_wholesale_cents: null,
      woo_product_id: 7,
      woo_variation_id: 8,
      is_active: true,
      attributes: { TALLA: "25.5", LARGO: "32" },
    },
  ],
};
describe("pantalla de revisión M9", () => {
  it("muestra identidad, clasificación y faltantes sin simular inventario", () => {
    const html = renderToStaticMarkup(
      createElement(MigrationReview, { data, filters: reviewFilters({}) }),
    );
    for (const text of [
      "0001",
      "JUVENIL",
      "BOTAS",
      "25.5",
      "LARGO: 32",
      "Sin capturar",
      "Sin definir",
      "Existencias no importadas",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("$0.00");
  });
  it("omite costo aun si accidentalmente llega un valor al componente sin permiso", () => {
    const html = renderToStaticMarkup(
      createElement(MigrationReview, {
        data: {
          ...data,
          can_view_cost: false,
          rows: [{ ...data.rows[0], cost_cents: 98765 }],
        },
        filters: reviewFilters({}),
      }),
    );
    expect(html).not.toContain("Costo");
    expect(html).not.toContain("987.65");
  });
  it("escapa contenido de origen", () => {
    const html = renderToStaticMarkup(
      createElement(MigrationReview, {
        data: {
          ...data,
          rows: [{ ...data.rows[0], name: "<script>alert(1)</script>" }],
        },
        filters: reviewFilters({}),
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
