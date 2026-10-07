import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpc: vi.fn(),
  single: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.authorize,
}));
vi.mock("@/lib/product-images", () => ({ uploadProductImage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { prepareSupplierOrderShare } from "../../app/(workspace)/compras/actions";

describe("preparar WhatsApp de proveedor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue({
      profile: { roles: { code: "ADMIN" } },
      supabase: { rpc: mocks.rpc, from: mocks.from },
    });
    mocks.rpc.mockResolvedValue({
      data: [
        { order_id: "order-1", supplier_id: "supplier-from-db", folio: 29 },
      ],
      error: null,
    });
    mocks.single.mockResolvedValue({
      data: { phone: "3521456880" },
      error: null,
    });
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: mocks.single }) }),
    });
  });
  it("valida en servidor y usa el teléfono y folio guardados", async () => {
    const result = await prepareSupplierOrderShare({
      orderId: "order-1",
      locationId: "location-1",
    });
    expect(mocks.authorize).toHaveBeenCalledWith("purchases.manage");
    expect(mocks.rpc).toHaveBeenCalledWith("list_purchase_orders_v2", {
      p_location_id: "location-1",
      p_limit: 100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toContain("wa.me/523521456880?text=");
  });
  it("niega otro rol aunque tenga permiso de compras", async () => {
    mocks.authorize.mockResolvedValue({
      profile: { roles: [{ code: "MANAGER" }] },
      supabase: { rpc: mocks.rpc, from: mocks.from },
    });
    expect(
      (
        await prepareSupplierOrderShare({
          orderId: "order-1",
          locationId: "location-1",
        })
      ).ok,
    ).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("niega una orden ajena y una sucursal no accesible", async () => {
    expect(
      (
        await prepareSupplierOrderShare({
          orderId: "other-order",
          locationId: "location-1",
        })
      ).ok,
    ).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "LOCATION_FORBIDDEN" },
    });
    expect(
      (
        await prepareSupplierOrderShare({
          orderId: "order-1",
          locationId: "other-location",
        })
      ).ok,
    ).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("no prepara enlace sin sesión ni teléfono válido", async () => {
    mocks.single.mockResolvedValue({ data: { phone: "" }, error: null });
    expect(
      (
        await prepareSupplierOrderShare({
          orderId: "order-1",
          locationId: "location-1",
        })
      ).ok,
    ).toBe(false);
    mocks.authorize.mockRejectedValue(new Error("NOT_AUTHENTICATED"));
    expect(
      (
        await prepareSupplierOrderShare({
          orderId: "order-1",
          locationId: "location-1",
        })
      ).ok,
    ).toBe(false);
  });
});
