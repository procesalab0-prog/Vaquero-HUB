import { expect, it } from "vitest";
import { dashboardAccess } from "../../lib/dashboard-access";
it("cajero ve venta/caja sin mostrar cifras de gerencia ni alta de productos", () => {
  expect(dashboardAccess(new Set(["pos.sell", "cash.open"]))).toEqual({
    sell: true,
    cash: true,
    createProduct: false,
    labels: false,
    inventory: false,
    sales: false,
  });
});
it("inventario y altas responden al permiso granular, no al nombre del rol", () => {
  const access = dashboardAccess(
    new Set(["inventory.read", "products.create", "products.read"]),
  );
  expect(access.inventory).toBe(true);
  expect(access.createProduct).toBe(true);
  expect(access.labels).toBe(true);
  expect(access.sell).toBe(false);
  expect(access.sales).toBe(false);
});
it("fallar la consulta de permisos no ofrece accesos operativos", () => {
  expect(
    Object.values(dashboardAccess(new Set())).every((value) => !value),
  ).toBe(true);
});
