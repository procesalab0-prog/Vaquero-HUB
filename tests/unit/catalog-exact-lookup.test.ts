import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: vi.fn(),
  photos: vi.fn(),
  covers: vi.fn(),
}));
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.auth }));
vi.mock("@/lib/remote-web-server", () => ({ queueEligibleRemoteWeb: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/product-images", () => ({
  uploadProductImage: vi.fn(),
  productImageUrl: (_: unknown, path: string | null) => path ?? undefined,
  readCatalogCoverUrls: mocks.covers,
}));
vi.mock("@/lib/variant-photos", () => ({ readVariantPhotos: mocks.photos }));
import { lookupCatalogBarcode } from "../../app/(workspace)/productos/actions";

const row = {
  variant_id: "variant",
  product_id: "product",
  product_name: "Camisa QA",
  primary_barcode: "0007",
  matched_barcode: "0007",
  sku: "1000000-9",
  category_id: "category",
  department_name: "CABALLERO",
  measure_unit_code: "PIECE",
  description: "Datos capturados",
  product_active: false,
  is_active: false,
  image_path: null,
  brand_name: "QA",
  price_cents: 74000,
  cost_cents: null,
  attributes: { TALLA: "S", COLOR: "Azul" },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: row, error: null });
  mocks.photos.mockResolvedValue(
    new Map([["variant", [{ url: "own-photo" }]]]),
  );
  mocks.covers.mockResolvedValue(new Map([["product", "parent-cover"]]));
});
describe("recuperación exacta del catálogo completo", () => {
  it("consulta el código literal sin depender de candidatos ni límite", async () => {
    const found = await lookupCatalogBarcode("0007");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "lookup_catalog_barcode",
      { p_code: "0007" },
    );
    expect(mocks.auth).toHaveBeenCalledWith("products.read");
    expect(found).toMatchObject({
      legacyCode: "0007",
      size: "S",
      price: 740,
      image: "own-photo",
      isActive: false,
      productActive: false,
      departmentName: "CABALLERO",
      categoryId: "category",
      measureUnitCode: "PIECE",
      description: "Datos capturados",
      cost: undefined,
    });
  });
  it("resuelve un código secundario conservando el código principal de la variante", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...row, matched_barcode: "ALIAS" },
      error: null,
    });
    expect((await lookupCatalogBarcode("ALIAS"))?.legacyCode).toBe("0007");
  });
  it("rechaza una respuesta de otra identidad", async () => {
    await expect(lookupCatalogBarcode("7")).rejects.toThrow(
      "CATALOG_LOOKUP_IDENTITY_CHANGED",
    );
    expect(mocks.photos).not.toHaveBeenCalled();
  });
  it("distingue una falla de consulta de un producto inexistente", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(lookupCatalogBarcode("0007")).rejects.toThrow(
      "CATALOG_LOOKUP_UNAVAILABLE",
    );
    log.mockRestore();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await lookupCatalogBarcode("0007")).toBeNull();
  });
  it("conserva el costo autorizado y usa la portada si no hay foto de variante", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...row, cost_cents: 32000 },
      error: null,
    });
    mocks.photos.mockResolvedValue(new Map());
    expect(await lookupCatalogBarcode("0007")).toMatchObject({
      cost: 320,
      image: "parent-cover",
    });
  });
  it("no consulta entradas vacías o demasiado largas", async () => {
    expect(await lookupCatalogBarcode("  ")).toBeNull();
    expect(await lookupCatalogBarcode("a".repeat(101))).toBeNull();
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});
