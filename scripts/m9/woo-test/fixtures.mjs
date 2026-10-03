export function sampleInput() {
  return {
    store: {
      id: "m9-local-2026-10-02",
      base_url: "http://127.0.0.1:9417",
      environment: "LOCAL_WOO_TEST",
    },
    product_id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    mode: "create",
    type: "variable",
    content: {
      name: "PRUEBA M9 — Camisa de laboratorio",
      base_code: "M9-LAB-CAMISA",
      description:
        "Producto ficticio para probar la integración.\nNo corresponde a mercancía de la tienda.",
      short_description: "M9-LAB-CAMISA",
      images: [
        {
          url: "http://127.0.0.1:9417/test-image.png",
          alt: "Imagen de ensayo",
        },
      ],
      categories: ["Laboratorio M9"],
    },
    bindings: {
      store_id: "m9-local-2026-10-02",
      categories: [{ id: 10, path: "Laboratorio M9" }],
      images: [{ id: 20, url: "http://127.0.0.1:9417/test-image.png" }],
    },
    variants: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        sku: "LAB-1000001-1",
        barcode: "000007779",
        price_cents: 82000,
        attributes: [{ name: "Talla", option: "M" }],
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        sku: "LAB-1000001-2",
        barcode: "LAB-002",
        price_cents: 89050,
        attributes: [{ name: "Talla", option: "XL" }],
      },
    ],
  };
}
