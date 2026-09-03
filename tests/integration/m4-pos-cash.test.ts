import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M4-2026!";
const runCode = Date.now().toString().slice(-8);
type Fixture = { id: string; code: string; client: SupabaseClient };

const state = {
  server: null as SupabaseClient | null,
  admin: null as Fixture | null,
  cashierA: null as Fixture | null,
  cashierB: null as Fixture | null,
  locationId: "",
  registerA: "",
  registerB: "",
  sessionA: "",
  sessionB: "",
};

function publicClient() {
  return createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function createVariant(name: string, stock: number, priceCents: number) {
  const server = state.server!;
  const { data: category } = await server.from("categories").select("id").eq("is_active", true).limit(1).single();
  const created = await state.admin!.client.rpc("create_catalog_product", {
    p_name: `${name} ${runCode}`,
    p_category_id: category!.id,
    p_variants: [{ cost_cents: Math.floor(priceCents / 2), price_cents: priceCents, attributes: {} }],
  });
  expect(created.error).toBeNull();
  const found = await state.admin!.client.rpc("search_catalog", { p_query: `${name} ${runCode}`, p_limit: 5 });
  expect(found.error).toBeNull();
  const variantId = found.data[0].variant_id as string;
  if (stock > 0) {
    const adjusted = await state.admin!.client.rpc("apply_inventory_adjustment", {
      p_variant_id: variantId, p_location_id: state.locationId, p_expected_qty: 0,
      p_counted_qty: stock, p_reason: "CONTEO_FISICO", p_note: "Preparación M4",
    });
    expect(adjusted.error).toBeNull();
  }
  return variantId;
}

function cashPayment(amount: number) {
  return [{ method_code: "CASH", amount_cents: amount, tendered_cents: amount }];
}

describe.sequential("M4: POS y caja", () => {
  beforeAll(async () => {
    const server = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
    state.server = server;
    const { data: roles } = await server.from("roles").select("id,code");
    const roleIds = Object.fromEntries((roles ?? []).map((role) => [role.code, role.id]));
    const { data: location, error: locationError } = await server.from("locations").insert({ code: `M4${runCode}`, name: "M4 Tienda", type: "STORE" }).select("id").single();
    expect(locationError).toBeNull(); state.locationId = location!.id;

    for (const definition of [{ key: "admin", role: "ADMIN" }, { key: "cashierA", role: "CASHIER" }, { key: "cashierB", role: "CASHIER" }] as const) {
      const email = `m4-${definition.key}-${runCode}@vaquero.test`;
      const { data: authData, error: authError } = await server.auth.admin.createUser({ email, password, email_confirm: true });
      expect(authError).toBeNull();
      const id = authData.user!.id; const code = `M4${definition.key.toUpperCase()}${runCode}`;
      expect((await server.from("app_users").insert({ id, employee_code: code, full_name: `M4 ${definition.key}`, email, role_id: roleIds[definition.role] })).error).toBeNull();
      expect((await server.from("user_locations").insert({ user_id: id, location_id: state.locationId })).error).toBeNull();
      const client = publicClient(); expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
      state[definition.key] = { id, code, client };
    }
    expect((await state.admin!.client.rpc("update_my_profile", { p_full_name: null, p_new_pin: "8642" })).error).toBeNull();
    const first = await state.admin!.client.rpc("create_cash_register", { p_location_id: state.locationId, p_code: "CAJA01", p_name: "Caja 01" });
    expect(first.error).toBeNull(); state.registerA = first.data.id;
    const second = await state.admin!.client.rpc("create_cash_register", { p_location_id: state.locationId, p_code: "CAJA02", p_name: "Caja 02" });
    expect(second.error).toBeNull(); state.registerB = second.data.id;
    const [openA, openB] = await Promise.all([
      state.cashierA!.client.rpc("open_cash_session", { p_register_id: state.registerA, p_opening_amount_cents: 100000 }),
      state.cashierB!.client.rpc("open_cash_session", { p_register_id: state.registerB, p_opening_amount_cents: 100000 }),
    ]);
    expect(openA.error).toBeNull(); expect(openB.error).toBeNull();
    state.sessionA = openA.data.id; state.sessionB = openB.data.id;
  }, 30_000);

  it("permite varias cajas, pero no dos sesiones en la misma caja o para el mismo cajero", async () => {
    const duplicateRegister = await state.admin!.client.rpc("open_cash_session", { p_register_id: state.registerA, p_opening_amount_cents: 0 });
    expect(duplicateRegister.error?.message).toContain("REGISTER_OR_CASHIER_ALREADY_OPEN");
    const registers = await state.admin!.client.rpc("list_cash_registers", { p_location_id: state.locationId });
    expect(registers.data.filter((row: { open_session_id: string | null }) => row.open_session_id)).toHaveLength(2);
  });

  it("exige motivo, conserva signo y no permite retirar más efectivo del disponible", async () => {
    const invalid = await state.cashierA!.client.rpc("record_cash_movement", { p_session_id: state.sessionA, p_type: "WITHDRAWAL", p_amount_cents: 100, p_reason: "" });
    expect(invalid.error?.message).toContain("INVALID_CASH_MOVEMENT");
    const tooMuch = await state.cashierA!.client.rpc("record_cash_movement", { p_session_id: state.sessionA, p_type: "WITHDRAWAL", p_amount_cents: 200000, p_reason: "Retiro imposible" });
    expect(tooMuch.error?.message).toContain("INSUFFICIENT_CASH");
    expect((await state.cashierA!.client.rpc("record_cash_movement", { p_session_id: state.sessionA, p_type: "DEPOSIT", p_amount_cents: 5000, p_reason: "Cambio adicional" })).error).toBeNull();
  });

  it("registra una venta una sola vez ante doble toque", async () => {
    const variantId = await createVariant("Doble toque", 2, 25000);
    const key = crypto.randomUUID();
    const input = { p_idempotency_key: key, p_cash_session_id: state.sessionA, p_items: [{ variant_id: variantId, quantity: 1 }], p_payments: cashPayment(25000), p_customer_id: null, p_discounts: [], p_notes: null };
    const [first, retry] = await Promise.all([state.cashierA!.client.rpc("create_sale", input), state.cashierA!.client.rpc("create_sale", input)]);
    expect(first.error).toBeNull(); expect(retry.error).toBeNull(); expect(first.data.id).toBe(retry.data.id);
    const stock = await state.server!.from("inventory_by_location").select("qty").eq("variant_id", variantId).eq("location_id", state.locationId).single();
    expect(Number(stock.data!.qty)).toBe(1);
  });

  it("hace atómica la venta: un pago incorrecto no descuenta inventario", async () => {
    const variantId = await createVariant("Pago inválido", 1, 30000);
    const result = await state.cashierA!.client.rpc("create_sale", { p_idempotency_key: crypto.randomUUID(), p_cash_session_id: state.sessionA, p_items: [{ variant_id: variantId, quantity: 1 }], p_payments: cashPayment(29999), p_customer_id: null, p_discounts: [], p_notes: null });
    expect(result.error?.message).toContain("PAYMENT_TOTAL_MISMATCH");
    const stock = await state.server!.from("inventory_by_location").select("qty").eq("variant_id", variantId).eq("location_id", state.locationId).single();
    expect(Number(stock.data!.qty)).toBe(1);
  });

  it("dos cajas disputando la última pieza producen una sola venta", async () => {
    const variantId = await createVariant("Última pieza", 1, 40000);
    const sale = (client: SupabaseClient, sessionId: string) => client.rpc("create_sale", { p_idempotency_key: crypto.randomUUID(), p_cash_session_id: sessionId, p_items: [{ variant_id: variantId, quantity: 1 }], p_payments: cashPayment(40000), p_customer_id: null, p_discounts: [], p_notes: null });
    const results = await Promise.all([sale(state.cashierA!.client, state.sessionA), sale(state.cashierB!.client, state.sessionB)]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(results.filter((result) => result.error?.message.includes("INSUFFICIENT_STOCK"))).toHaveLength(1);
  });

  it("reparte hasta el último centavo del descuento con largest remainder", async () => {
    const firstVariant = await createVariant("Línea treinta", 1, 30);
    const secondVariant = await createVariant("Línea setenta", 1, 70);
    const authorization = await state.cashierA!.client.rpc("verify_supervisor_pin", { p_employee_code: state.admin!.code, p_pin: "8642", p_permission: "sales.discount" });
    expect(authorization.data.status).toBe("AUTHORIZED");
    const sale = await state.cashierA!.client.rpc("create_sale", {
      p_idempotency_key: crypto.randomUUID(), p_cash_session_id: state.sessionA,
      p_items: [{ variant_id: firstVariant, quantity: 1 }, { variant_id: secondVariant, quantity: 1 }],
      p_payments: cashPayment(99), p_customer_id: null,
      p_discounts: [{ scope: "TICKET", type: "AMOUNT", value: 1, authorization_token: authorization.data.authorization_token }], p_notes: null,
    });
    expect(sale.error).toBeNull(); expect(sale.data.total_cents).toBe(99);
    const items = await state.server!.from("sale_items").select("line_number,ticket_discount_cents").eq("sale_id", sale.data.id).order("line_number");
    expect(items.data).toEqual([{ line_number: 1, ticket_discount_cents: 0 }, { line_number: 2, ticket_discount_cents: 1 }]);
  });

  it("el cierre es ciego y exige explicación cuando hay diferencia", async () => {
    const preview = await state.cashierB!.client.rpc("preview_cash_close", { p_session_id: state.sessionB, p_counted_amount_cents: 0 });
    expect(preview.error).toBeNull(); expect(Number(preview.data.expected_amount_cents)).toBeGreaterThan(0);
    const rejected = await state.cashierB!.client.rpc("close_cash_session", { p_session_id: state.sessionB, p_counted_amount_cents: 0, p_difference_reason: null });
    expect(rejected.error?.message).toContain("DIFFERENCE_REASON_REQUIRED");
    const closed = await state.cashierB!.client.rpc("close_cash_session", { p_session_id: state.sessionB, p_counted_amount_cents: 0, p_difference_reason: "Prueba controlada de diferencia" });
    expect(closed.error).toBeNull(); expect(closed.data.status).toBe("CLOSED");
  });

  it("un cliente autenticado no puede escribir directamente en los libros", async () => {
    expect((await state.cashierA!.client.from("sales").delete().eq("cash_session_id", state.sessionA)).error).not.toBeNull();
    expect((await state.cashierA!.client.from("cash_movements").insert({})).error).not.toBeNull();
  });
});
