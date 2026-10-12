/** Presentation follows granular permissions, never a role label supplied by the browser. */
export function dashboardAccess(
  permissions: ReadonlySet<string>,
  demo = false,
) {
  const has = (code: string) => demo || permissions.has(code);
  return {
    sell: has("pos.sell"),
    createProduct: has("products.create"),
    labels: has("products.read"),
    cash: has("cash.open"),
    inventory: has("inventory.read"),
    sales: has("reports.sales"),
  };
}
