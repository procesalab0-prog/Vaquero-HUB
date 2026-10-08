import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.authorize,
}));
vi.mock("@/lib/product-images", () => ({ uploadProductImage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  createPurchaseOrder,
  receivePurchaseOrder,
} from "../../app/(workspace)/compras/actions";

describe("transporte de cantidades de compra", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
    mocks.rpc.mockResolvedValue({ data: { folio: 1 }, error: null });
  });
  it("conserva la cantidad decimal y deja la unidad real a cargo del servidor", async () => {
    expect(
      (
        await createPurchaseOrder({
          supplierId: "supplier",
          locationId: "location",
          items: [{ variantId: "variant", qty: 1.25, unitCostCents: 12345 }],
        })
      ).ok,
    ).toBe(true);
    expect(mocks.authorize).toHaveBeenCalledWith("purchases.manage");
    expect(mocks.rpc.mock.calls[0][1].p_items[0].qty).toBe(1.25);
  });
  it("rechaza precisión excesiva antes de intentar crear la orden", async () => {
    expect(
      (
        await createPurchaseOrder({
          supplierId: "supplier",
          locationId: "location",
          items: [{ variantId: "variant", qty: 1.0001, unitCostCents: 100 }],
        })
      ).ok,
    ).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("recibe 0.625 sin redondearlo a una pieza y omite sólo ceros válidos", async () => {
    expect(
      (
        await receivePurchaseOrder({
          orderId: "order",
          idempotencyKey: "key",
          items: [
            { purchaseItemId: "item", qty: 0.625 },
            { purchaseItemId: "other", qty: 0 },
          ],
        })
      ).ok,
    ).toBe(true);
    expect(mocks.authorize).toHaveBeenCalledWith("purchases.receive");
    expect(mocks.rpc.mock.calls[0][1].p_items).toEqual([
      { purchase_item_id: "item", qty: 0.625 },
    ]);
  });
  it("no descarta un negativo para hacer pasar el resto de la recepción", async () => {
    expect(
      (
        await receivePurchaseOrder({
          orderId: "order",
          idempotencyKey: "key",
          items: [
            { purchaseItemId: "item", qty: 1 },
            { purchaseItemId: "other", qty: -1 },
          ],
        })
      ).ok,
    ).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("explica el rechazo real de unidad recibido de Supabase", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "INVALID_MEASURE_QUANTITY" },
    });
    const result = await createPurchaseOrder({
      supplierId: "supplier",
      locationId: "location",
      items: [{ variantId: "piece-variant", qty: 0.5, unitCostCents: 100 }],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("piezas y pares enteros");
  });
});
