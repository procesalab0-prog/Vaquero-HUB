import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M6-2026!";
const runCode = Date.now().toString().slice(-8);

type Fixture = { id: string; client: SupabaseClient };
const state = {
  server: null as SupabaseClient | null,
  manager: null as Fixture | null,
  cashier: null as Fixture | null,
  warehouse: null as Fixture | null,
  locationId: "",
  productId: "",
  variantId: "",
  supplierId: "",
  orderId: "",
  purchaseItemId: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.sequential("M6: compras, proveedores y recepción", () => {
  beforeAll(async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    state.server = server;
    const { data: roles } = await server.from("roles").select("id,code");
    const roleIds = Object.fromEntries(
      (roles ?? []).map((role) => [role.code, role.id]),
    );
    const { data: location, error: locationError } = await server
      .from("locations")
      .insert({ code: `M6${runCode}`, name: "M6 Sucursal", type: "STORE" })
      .select("id")
      .single();
    expect(locationError).toBeNull();
    state.locationId = location!.id;
    for (const definition of [
      { key: "manager", role: "MANAGER" },
      { key: "cashier", role: "CASHIER" },
      { key: "warehouse", role: "WAREHOUSE" },
    ] as const) {
      const email = `m6-${definition.key}-${runCode}@vaquero.test`;
      const { data: authData } = await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      const id = authData.user!.id;
      expect(
        (
          await server.from("app_users").insert({
            id,
            employee_code: `M6${definition.key.toUpperCase()}${runCode}`,
            full_name: `M6 ${definition.key}`,
            email,
            role_id: roleIds[definition.role],
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await server
            .from("user_locations")
            .insert({ user_id: id, location_id: state.locationId })
        ).error,
      ).toBeNull();
      const client = publicClient();
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      state[definition.key] = { id, client };
    }
    const { data: category } = await server
      .from("categories")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    const created = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Producto compra ${runCode}`,
        p_category_id: category!.id,
        p_variants: [{ cost_cents: 10000, price_cents: 18000, attributes: {} }],
      },
    );
    expect(created.error).toBeNull();
    state.productId = created.data.product_id;
    const catalog = await state.manager!.client.rpc("search_catalog", {
      p_query: `Producto compra ${runCode}`,
      p_limit: 5,
    });
    state.variantId = catalog.data[0].variant_id;
    const supplier = await state.manager!.client.rpc("upsert_supplier", {
      p_id: null,
      p_code: `P${runCode}`,
      p_name: "Proveedor M6",
      p_contact_name: null,
      p_phone: null,
      p_email: null,
      p_tax_id: null,
      p_notes: null,
      p_is_active: true,
    });
    expect(supplier.error).toBeNull();
    state.supplierId = supplier.data;
  }, 30_000);

  it("una orden no mueve inventario", async () => {
    const order = await state.manager!.client.rpc("create_purchase_order", {
      p_supplier_id: state.supplierId,
      p_location_id: state.locationId,
      p_items: [
        { variant_id: state.variantId, qty: 10, unit_cost_cents: 12000 },
      ],
      p_expected_at: null,
      p_notes: null,
    });
    expect(order.error).toBeNull();
    state.orderId = order.data.id;
    const { data: items } = await state
      .manager!.client.from("purchase_items")
      .select("id")
      .eq("purchase_order_id", state.orderId)
      .single();
    state.purchaseItemId = items!.id;
    const snapshot = await state.manager!.client.rpc("get_inventory_snapshot", {
      p_location_id: state.locationId,
      p_query: runCode,
      p_limit: 10,
    });
    expect(Number(snapshot.data[0].qty)).toBe(0);
  });

  it("una recepción parcial mueve exactamente lo recibido", async () => {
    const result = await state.warehouse!.client.rpc("receive_purchase_order", {
      p_order_id: state.orderId,
      p_items: [{ purchase_item_id: state.purchaseItemId, qty: 4 }],
      p_idempotency_key: crypto.randomUUID(),
      p_notes: null,
    });
    expect(result.error).toBeNull();
    expect(result.data.order_status).toBe("PARTIALLY_RECEIVED");
    const snapshot = await state.manager!.client.rpc("get_inventory_snapshot", {
      p_location_id: state.locationId,
      p_query: runCode,
      p_limit: 10,
    });
    expect(Number(snapshot.data[0].qty)).toBe(4);
    const orders = await state.manager!.client.rpc("list_purchase_orders", {
      p_location_id: state.locationId,
      p_limit: 10,
    });
    expect(Number(orders.data[0].received_qty)).toBe(4);
    expect(Number(orders.data[0].items[0].remaining_qty)).toBe(6);
  });

  it("dos recepciones concurrentes no pueden recibir de más", async () => {
    const calls = await Promise.all(
      [4, 4].map((qty) =>
        state.warehouse!.client.rpc("receive_purchase_order", {
          p_order_id: state.orderId,
          p_items: [{ purchase_item_id: state.purchaseItemId, qty }],
          p_idempotency_key: crypto.randomUUID(),
          p_notes: null,
        }),
      ),
    );
    expect(calls.filter((call) => !call.error)).toHaveLength(1);
    expect(calls.find((call) => call.error)?.error?.message).toContain(
      "RECEIPT_EXCEEDS_ORDER",
    );
    const snapshot = await state.manager!.client.rpc("get_inventory_snapshot", {
      p_location_id: state.locationId,
      p_query: runCode,
      p_limit: 10,
    });
    expect(Number(snapshot.data[0].qty)).toBe(8);
  });

  it("el cajero no puede leer ni crear compras", async () => {
    expect(
      (await state.cashier!.client.from("purchase_orders").select("id")).data,
    ).toEqual([]);
    const result = await state.cashier!.client.rpc("create_purchase_order", {
      p_supplier_id: state.supplierId,
      p_location_id: state.locationId,
      p_items: [{ variant_id: state.variantId, qty: 1, unit_cost_cents: 1 }],
      p_expected_at: null,
      p_notes: null,
    });
    expect(result.error?.message).toContain("NOT_AUTHORIZED");
  });

  it("guarda una foto comercial sólo mediante Storage y permiso de catálogo", async () => {
    const path = `${state.productId}/${crypto.randomUUID()}.png`;
    const image = new Blob([new Uint8Array([137, 80, 78, 71])], {
      type: "image/png",
    });
    const uploaded = await state
      .warehouse!.client.storage.from("product-images")
      .upload(path, image, { contentType: "image/png" });
    expect(uploaded.error).toBeNull();
    const linked = await state.warehouse!.client.rpc("set_product_image", {
      p_product_id: state.productId,
      p_storage_path: path,
    });
    expect(linked.error).toBeNull();
    const { data: product } = await state
      .server!.from("products")
      .select("image_path")
      .eq("id", state.productId)
      .single();
    expect(product!.image_path).toBe(path);

    const forbidden = await state.cashier!.client.rpc("set_product_image", {
      p_product_id: state.productId,
      p_storage_path: path,
    });
    expect(forbidden.error?.message).toContain("NOT_AUTHORIZED");

    const forbiddenUpload = await state
      .cashier!.client.storage.from("product-images")
      .upload(`${state.productId}/${crypto.randomUUID()}.png`, image, {
        contentType: "image/png",
      });
    expect(forbiddenUpload.error).not.toBeNull();
  });

  it("el historial es inmutable incluso para service_role", async () => {
    const attempt = await state
      .server!.from("receipt_items")
      .delete()
      .neq("id", crypto.randomUUID());
    expect(attempt.error).not.toBeNull();
  });
});
