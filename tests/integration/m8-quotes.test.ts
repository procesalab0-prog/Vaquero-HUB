import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M8-Q-2026!";
const runCode = Date.now().toString().slice(-8);

const state = {
  server: null as SupabaseClient | null,
  admin: null as SupabaseClient | null,
  locationId: "",
  variantId: "",
  sessionId: "",
  quoteId: "",
  quoteTotal: 0,
};

describe.sequential("M8.2: cotizaciones", () => {
  beforeAll(async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    state.server = server;
    const { data: adminRole } = await server
      .from("roles")
      .select("id")
      .eq("code", "ADMIN")
      .single();
    const location = await server
      .from("locations")
      .insert({ code: `Q${runCode}`, name: "Cotizaciones", type: "STORE" })
      .select("id")
      .single();
    expect(location.error).toBeNull();
    state.locationId = location.data!.id;

    const email = `m8-quotes-${runCode}@vaquero.test`;
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
          employee_code: `Q${runCode}`,
          full_name: "Cotizador",
          email,
          role_id: adminRole!.id,
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
    const admin = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    expect(
      (await admin.auth.signInWithPassword({ email, password })).error,
    ).toBeNull();
    state.admin = admin;

    const category = await server
      .from("categories")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    const product = await admin.rpc("create_catalog_product", {
      p_name: `Artículo cotizable ${runCode}`,
      p_category_id: category.data!.id,
      p_variants: [{ cost_cents: 10000, price_cents: 25000, attributes: {} }],
    });
    expect(product.error).toBeNull();
    const catalog = await admin.rpc("search_catalog", {
      p_query: `Artículo cotizable ${runCode}`,
      p_limit: 5,
    });
    state.variantId = catalog.data[0].variant_id;
    expect(
      (
        await admin.rpc("apply_inventory_adjustment", {
          p_variant_id: state.variantId,
          p_location_id: state.locationId,
          p_expected_qty: 0,
          p_counted_qty: 3,
          p_reason: "CONTEO_FISICO",
          p_note: "Preparación M8.2",
        })
      ).error,
    ).toBeNull();
    const register = await admin.rpc("create_cash_register", {
      p_location_id: state.locationId,
      p_code: "CAJA01",
      p_name: "Caja 01",
    });
    const session = await admin.rpc("open_cash_session", {
      p_register_id: register.data.id,
      p_opening_amount_cents: 50000,
    });
    state.sessionId = session.data.id;
  }, 30_000);

  it("crea una cotización sin mover inventario ni caja", async () => {
    const beforeStock = await state
      .server!.from("inventory_by_location")
      .select("qty,reserved_qty")
      .eq("variant_id", state.variantId)
      .eq("location_id", state.locationId)
      .single();
    const beforeCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionId);
    const quote = await state.admin!.rpc("create_quote", {
      p_location_id: state.locationId,
      p_items: [{ variant_id: state.variantId, quantity: 2 }],
      p_customer_id: null,
      p_valid_until: null,
      p_notes: "Cotización de prueba",
    });
    expect(quote.error).toBeNull();
    state.quoteId = quote.data.id;
    state.quoteTotal = Number(quote.data.total_cents);
    expect(quote.data.status).toBe("DRAFT");
    expect(state.quoteTotal).toBe(50000);
    const afterStock = await state
      .server!.from("inventory_by_location")
      .select("qty,reserved_qty")
      .eq("variant_id", state.variantId)
      .eq("location_id", state.locationId)
      .single();
    const afterCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionId);
    expect(afterStock.data).toEqual(beforeStock.data);
    expect(afterCash.count).toBe(beforeCash.count);
  });

  it("la carga en Venta y la convierte una sola vez por el flujo normal", async () => {
    expect(
      (await state.admin!.rpc("send_quote", { p_quote_id: state.quoteId }))
        .error,
    ).toBeNull();
    expect(
      (
        await state.admin!.rpc("load_quote_into_pos", {
          p_quote_id: state.quoteId,
          p_cash_session_id: state.sessionId,
        })
      ).error,
    ).toBeNull();
    const calls = [crypto.randomUUID(), crypto.randomUUID()].map((key) =>
      state.admin!.rpc("convert_quote_to_sale", {
        p_quote_id: state.quoteId,
        p_idempotency_key: key,
        p_cash_session_id: state.sessionId,
        p_payments: [
          {
            method_code: "CASH",
            amount_cents: state.quoteTotal,
            tendered_cents: state.quoteTotal,
          },
        ],
      }),
    );
    const results = await Promise.all(calls);
    expect(results.every((result) => result.error === null)).toBe(true);
    expect(results[0].data.id).toBe(results[1].data.id);
    const quote = await state
      .server!.from("quotes")
      .select("status,converted_sale_id")
      .eq("id", state.quoteId)
      .single();
    expect(quote.data).toEqual({
      status: "CONVERTED",
      converted_sale_id: results[0].data.id,
    });
    const stock = await state
      .server!.from("inventory_by_location")
      .select("qty")
      .eq("variant_id", state.variantId)
      .eq("location_id", state.locationId)
      .single();
    expect(Number(stock.data!.qty)).toBe(1);
  });

  it("no permite acceso directo a las tablas desde el navegador", async () => {
    const direct = await state.admin!.from("quotes").select("id");
    expect(direct.error).not.toBeNull();
    const listed = await state.admin!.rpc("list_quotes", {
      p_location_id: state.locationId,
      p_status: "CONVERTED",
      p_query: "",
      p_limit: 10,
    });
    expect(listed.error).toBeNull();
    expect(listed.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: state.quoteId })]),
    );
  });
});
