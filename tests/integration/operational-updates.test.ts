import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const run = Date.now().toString().slice(-8);
let admin: SupabaseClient;
let cashier: SupabaseClient;
let server: SupabaseClient;
let locationId: string;
let sessionId: string;
let productId: string;
let variantId: string;
let identity: unknown;

describe.sequential("aceptación Auth/PostgREST de mejoras operativas", () => {
  beforeAll(async () => {
    server = createClient(url, secret, { auth: { persistSession: false } });
    const location = await server
      .from("locations")
      .insert({
        code: `OP${run}`,
        name: "QA mejoras aisladas",
        type: "STORE",
      })
      .select("id")
      .single();
    expect(location.error).toBeNull();
    locationId = location.data!.id;
    const clients: SupabaseClient[] = [];
    for (const [index, roleCode] of ["ADMIN", "CASHIER"].entries()) {
      const role = await server
        .from("roles")
        .select("id")
        .eq("code", roleCode)
        .single();
      expect(role.error).toBeNull();
      const email = `operational-${run}-${index}@vaquero.test`;
      const password = "Operational-QA-local-2026!";
      const user = await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(user.error).toBeNull();
      const id = user.data.user!.id;
      expect(
        (
          await server.from("app_users").insert({
            id,
            email,
            full_name: `QA ${roleCode}`,
            employee_code: `OP${index}${run}`,
            role_id: role.data!.id,
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await server
            .from("user_locations")
            .insert({ user_id: id, location_id: locationId })
        ).error,
      ).toBeNull();
      const client = createClient(url, key, {
        auth: { persistSession: false },
      });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      clients.push(client);
    }
    [admin, cashier] = clients;
    const register = await admin.rpc("create_cash_register", {
      p_location_id: locationId,
      p_code: "OP01",
      p_name: "Caja QA",
    });
    expect(register.error).toBeNull();
    const session = await cashier.rpc("open_cash_session", {
      p_register_id: register.data.id,
      p_opening_amount_cents: 10000,
    });
    expect(session.error).toBeNull();
    sessionId = session.data.id;
    const category = await server
      .from("categories")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    expect(category.error).toBeNull();
    const product = await admin.rpc("create_catalog_product", {
      p_name: `QA recuperación ${run}`,
      p_category_id: category.data!.id,
      p_variants: [{ cost_cents: 0, price_cents: 10000, attributes: {} }],
    });
    expect(product.error).toBeNull();
    productId = product.data.product_id;
    const variant = await server
      .from("variants")
      .select(
        "id,sku,legacy_sicar_code,woocommerce_product_id,woocommerce_variation_id",
      )
      .eq("product_id", productId)
      .single();
    expect(variant.error).toBeNull();
    variantId = variant.data!.id;
    identity = variant.data;
  }, 30000);

  it("mantiene USD apagado y no permite leer sus tablas financieras", async () => {
    const available = await cashier.rpc("usd_checkout_available");
    expect(available.error).toBeNull();
    expect(available.data).toBe(false);
    for (const table of [
      "usd_cash_movements",
      "usd_sale_tenders",
      "fx_rate_observations",
    ]) {
      expect((await cashier.from(table).select("*")).error).not.toBeNull();
    }
    expect(
      (
        await cashier.rpc("record_banxico_fix", {
          p_date: "2026-10-01",
          p_rate_million: 20000000,
        })
      ).error,
    ).not.toBeNull();
  });

  it("rechaza asignación fraccionaria y conserva identidad, unidad y códigos", async () => {
    const assign = await admin.rpc("set_product_measure_unit", {
      p_product_id: productId,
      p_unit_code: "KILO",
      p_expected_code: "PIECE",
    });
    expect(assign.error?.message).toContain("UNIT_FRACTIONAL_FLOW_PENDING");
    const product = await server
      .from("products")
      .select("measure_unit_code")
      .eq("id", productId)
      .single();
    expect(product.error).toBeNull();
    expect(product.data!.measure_unit_code).toBe("PIECE");
    const variant = await server
      .from("variants")
      .select(
        "id,sku,legacy_sicar_code,woocommerce_product_id,woocommerce_variation_id",
      )
      .eq("id", variantId)
      .single();
    expect(variant.error).toBeNull();
    expect(variant.data).toEqual(identity);
  });

  it("rechaza costo capturado por cajera sin crear venta ni inventario", async () => {
    const result = await cashier.rpc("create_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: sessionId,
      p_items: [
        {
          variant_id: crypto.randomUUID(),
          quantity: 1,
          gift_receipt: false,
          quick: {
            name: "Rápido rechazado",
            unit_price_cents: 10000,
            unit_cost_cents: 1,
          },
        },
      ],
      p_payments: [
        { method_code: "CASH", amount_cents: 10000, tendered_cents: 10000 },
      ],
    });
    expect(result.error?.message).toContain("QUICK_COST_FORBIDDEN");
    const sales = await server
      .from("sales")
      .select("id")
      .eq("cash_session_id", sessionId);
    expect(sales.error).toBeNull();
    expect(sales.data).toEqual([]);
  });

  it("cobra rápido una sola vez, recupera datos comerciales y no inventa variante ni stock", async () => {
    const quickId = crypto.randomUUID();
    const args = {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: sessionId,
      p_items: [
        {
          variant_id: quickId,
          quantity: 2,
          gift_receipt: false,
          quick: { name: "Mercancía sin catalogar", unit_price_cents: 12345 },
        },
      ],
      p_payments: [
        { method_code: "CASH", amount_cents: 24690, tendered_cents: 25000 },
      ],
    };
    const results = await Promise.all([
      cashier.rpc("create_sale", args),
      cashier.rpc("create_sale", args),
    ]);
    expect(results.map((r) => r.error)).toEqual([null, null]);
    expect(results[0].data.id).toBe(results[1].data.id);
    expect(Number(results[0].data.total_cents)).toBe(24690);
    const line = await server
      .from("sale_items")
      .select("variant_id,sku,quick_line_id,quick_cost_recorded")
      .eq("sale_id", results[0].data.id)
      .single();
    expect(line.error).toBeNull();
    expect(line.data).toEqual({
      variant_id: null,
      sku: null,
      quick_line_id: quickId,
      quick_cost_recorded: false,
    });
    const history = await admin.rpc("list_quick_sale_items", {
      p_location_id: locationId,
    });
    expect(history.error).toBeNull();
    expect(history.data).toHaveLength(1);
    expect(history.data[0].product_name).toBe("Mercancía sin catalogar");
    expect(history.data[0]).not.toHaveProperty("unit_cost_cents");
    const variants = await server
      .from("variants")
      .select("id")
      .eq("id", quickId);
    expect(variants.error).toBeNull();
    expect(variants.data).toEqual([]);
    const movements = await server
      .from("inventory_movements")
      .select("id")
      .eq("location_id", locationId);
    expect(movements.error).toBeNull();
    expect(movements.data).toEqual([]);
    const receipt = await cashier.rpc("get_sale_receipt", {
      p_sale_id: results[0].data.id,
    });
    expect(receipt.error).toBeNull();
    expect(receipt.data.items[0].sku).toBe("");
    expect(
      (
        await cashier.rpc("list_quick_sale_items", {
          p_location_id: locationId,
        })
      ).error,
    ).not.toBeNull();
  });
});
