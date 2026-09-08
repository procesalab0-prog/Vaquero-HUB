import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M8-2026!";
const runCode = Date.now().toString().slice(-8);

const state = {
  server: null as SupabaseClient | null,
  admin: null as SupabaseClient | null,
  cashier: null as SupabaseClient | null,
  locationId: "",
  variantId: "",
  sessionId: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.sequential("M8: reportes de ventas e inventario", () => {
  beforeAll(async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    state.server = server;
    const { data: roles } = await server.from("roles").select("id,code");
    const roleIds = Object.fromEntries(
      (roles ?? []).map((role) => [role.code, role.id]),
    );
    const location = await server
      .from("locations")
      .insert({ code: `M8${runCode}`, name: "M8 Tienda", type: "STORE" })
      .select("id")
      .single();
    expect(location.error).toBeNull();
    state.locationId = location.data!.id;

    for (const definition of [
      { key: "admin", role: "ADMIN" },
      { key: "cashier", role: "CASHIER" },
    ] as const) {
      const email = `m8-${definition.key}-${runCode}@vaquero.test`;
      const auth = await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(auth.error).toBeNull();
      const userId = auth.data.user!.id;
      expect(
        (
          await server.from("app_users").insert({
            id: userId,
            employee_code: `M8${definition.key.toUpperCase()}${runCode}`,
            full_name: `M8 ${definition.key}`,
            email,
            role_id: roleIds[definition.role],
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await server
            .from("user_locations")
            .insert({ user_id: userId, location_id: state.locationId })
        ).error,
      ).toBeNull();
      const client = publicClient();
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      state[definition.key] = client;
    }

    const category = await server
      .from("categories")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    const product = await state.admin!.rpc("create_catalog_product", {
      p_name: `Bota reporte ${runCode}`,
      p_category_id: category.data!.id,
      p_variants: [
        {
          cost_cents: 10000,
          price_cents: 20000,
          attributes: {},
        },
      ],
    });
    expect(product.error).toBeNull();
    const search = await state.admin!.rpc("search_catalog", {
      p_query: `Bota reporte ${runCode}`,
      p_limit: 5,
    });
    state.variantId = search.data[0].variant_id;
    expect(
      (
        await state.admin!.rpc("apply_inventory_adjustment", {
          p_variant_id: state.variantId,
          p_location_id: state.locationId,
          p_expected_qty: 0,
          p_counted_qty: 5,
          p_reason: "CONTEO_FISICO",
          p_note: "Preparación M8",
        })
      ).error,
    ).toBeNull();
    const register = await state.admin!.rpc("create_cash_register", {
      p_location_id: state.locationId,
      p_code: "CAJA01",
      p_name: "Caja 01",
    });
    const session = await state.admin!.rpc("open_cash_session", {
      p_register_id: register.data.id,
      p_opening_amount_cents: 50000,
    });
    state.sessionId = session.data.id;
    const sale = await state.admin!.rpc("create_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionId,
      p_items: [{ variant_id: state.variantId, quantity: 1 }],
      p_payments: [
        { method_code: "CASH", amount_cents: 10000, tendered_cents: 10000 },
        { method_code: "CARD", amount_cents: 10000 },
      ],
      p_customer_id: null,
      p_discounts: [],
      p_notes: null,
    });
    expect(sale.error).toBeNull();
  }, 30_000);

  it("hace cuadrar la venta neta contra los métodos cobrados", async () => {
    const report = await state.admin!.rpc("get_sales_report", {
      p_location_id: state.locationId,
      p_from: "2026-01-01T00:00:00Z",
      p_to: "2026-12-31T00:00:00Z",
      p_grouping: "day",
      p_query: "",
    });
    expect(report.error).toBeNull();
    expect(report.data.summary.sale_count).toBe(1);
    expect(report.data.summary.net_cents).toBe(20000);
    expect(report.data.summary.payment_total_cents).toBe(20000);
    expect(report.data.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CASH", amount_cents: 10000 }),
        expect.objectContaining({ code: "CARD", amount_cents: 10000 }),
      ]),
    );
  });

  it("filtra por producto sin atribuirle pagos mixtos de todo el ticket", async () => {
    const report = await state.admin!.rpc("get_sales_report", {
      p_location_id: state.locationId,
      p_from: "2026-01-01T00:00:00Z",
      p_to: "2026-12-31T00:00:00Z",
      p_grouping: "month",
      p_query: "Bota reporte",
    });
    expect(report.error).toBeNull();
    expect(report.data.scope).toBe("PRODUCT_LINES");
    expect(report.data.summary.net_cents).toBe(20000);
    expect(report.data.summary.payment_total_cents).toBeNull();
    expect(report.data.details[0].product_name).toContain("Bota reporte");
  });

  it("reporta existencia y valor sin perder las reservadas", async () => {
    const report = await state.admin!.rpc("get_inventory_report", {
      p_location_id: state.locationId,
      p_query: `Bota reporte ${runCode}`,
    });
    expect(report.error).toBeNull();
    expect(report.data.summary.qty).toBe(4);
    expect(report.data.summary.available_qty).toBe(4);
    expect(report.data.summary.cost_value_cents).toBe(40000);
    expect(report.data.items[0]).toEqual(
      expect.objectContaining({ cost_cents: 10000, price_cents: 20000 }),
    );
  });

  it("niega reportes de dinero e inventario a un cajero", async () => {
    const [sales, inventory] = await Promise.all([
      state.cashier!.rpc("get_sales_report", {
        p_location_id: state.locationId,
        p_from: "2026-01-01T00:00:00Z",
        p_to: "2026-12-31T00:00:00Z",
        p_grouping: "day",
        p_query: "",
      }),
      state.cashier!.rpc("get_inventory_report", {
        p_location_id: state.locationId,
        p_query: "",
      }),
    ]);
    expect(sales.error?.message).toContain("NOT_AUTHORIZED");
    expect(inventory.error?.message).toContain("NOT_AUTHORIZED");
  });
});
