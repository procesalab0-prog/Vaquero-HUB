import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M7-Ventas-2026!";
const runCode = Date.now().toString().slice(-8);
type Fixture = { id: string; client: SupabaseClient };

const state = {
  server: null as SupabaseClient | null,
  admin: null as Fixture | null,
  cashierA: null as Fixture | null,
  cashierB: null as Fixture | null,
  locationId: "",
  sessionA: "",
  sessionB: "",
  customerId: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createVariant(label: string, priceCents: number) {
  const { data: category } = await state
    .server!.from("categories")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .single();
  const created = await state.admin!.client.rpc("create_catalog_product", {
    p_name: `${label} ${runCode}`,
    p_category_id: category!.id,
    p_variants: [{ cost_cents: 1000, price_cents: priceCents, attributes: {} }],
  });
  expect(created.error).toBeNull();
  const found = await state.admin!.client.rpc("search_catalog", {
    p_query: `${label} ${runCode}`,
    p_limit: 5,
  });
  const variantId = found.data[0].variant_id as string;
  expect(
    (
      await state.admin!.client.rpc("apply_inventory_adjustment", {
        p_variant_id: variantId,
        p_location_id: state.locationId,
        p_expected_qty: 0,
        p_counted_qty: 2,
        p_reason: "CONTEO_FISICO",
        p_note: "Preparación M7.2",
      })
    ).error,
  ).toBeNull();
  return variantId;
}

describe.sequential("M7.2: ventas a crédito y abonos", () => {
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
      .insert({ code: `CV${runCode}`, name: "Crédito ventas", type: "STORE" })
      .select("id")
      .single();
    expect(location.error).toBeNull();
    state.locationId = location.data!.id;

    for (const definition of [
      { key: "admin", role: "ADMIN" },
      { key: "cashierA", role: "CASHIER" },
      { key: "cashierB", role: "CASHIER" },
    ] as const) {
      const email = `m7-sales-${definition.key}-${runCode}@vaquero.test`;
      const auth = await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(auth.error).toBeNull();
      const id = auth.data.user!.id;
      expect(
        (
          await server.from("app_users").insert({
            id,
            employee_code: `CV${definition.key.toUpperCase()}${runCode}`,
            full_name: `Crédito venta ${definition.key}`,
            email,
            role_id: roleIds[definition.role],
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await server.from("user_locations").insert({
            user_id: id,
            location_id: state.locationId,
          })
        ).error,
      ).toBeNull();
      const client = publicClient();
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      state[definition.key] = { id, client };
    }

    const registerA = await state.admin!.client.rpc("create_cash_register", {
      p_location_id: state.locationId,
      p_code: "CAJA01",
      p_name: "Caja 01",
    });
    const registerB = await state.admin!.client.rpc("create_cash_register", {
      p_location_id: state.locationId,
      p_code: "CAJA02",
      p_name: "Caja 02",
    });
    const [openA, openB] = await Promise.all([
      state.cashierA!.client.rpc("open_cash_session", {
        p_register_id: registerA.data.id,
        p_opening_amount_cents: 10000,
      }),
      state.cashierB!.client.rpc("open_cash_session", {
        p_register_id: registerB.data.id,
        p_opening_amount_cents: 10000,
      }),
    ]);
    expect(openA.error).toBeNull();
    expect(openB.error).toBeNull();
    state.sessionA = openA.data.id;
    state.sessionB = openB.data.id;

    const customer = await state.cashierA!.client.rpc("create_customer", {
      p_full_name: `Cliente venta crédito ${runCode}`,
      p_phone: `354${runCode.padStart(8, "0").slice(-7)}`,
      p_location_id: state.locationId,
      p_privacy_notice_version: "TEST-M7.2",
    });
    expect(customer.error).toBeNull();
    state.customerId = customer.data.id;
    expect(
      (
        await state.admin!.client.rpc("set_customer_credit", {
          p_customer_id: state.customerId,
          p_is_authorized: true,
          p_limit_cents: 30000,
          p_reason: "Prueba de concurrencia",
        })
      ).error,
    ).toBeNull();
  }, 30_000);

  it("impide usar Crédito por la función de venta normal", async () => {
    const variantId = await createVariant("Puerta trasera", 10000);
    const forged = await state.cashierA!.client.rpc("create_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_payments: [{ method_code: "CREDIT", amount_cents: 10000 }],
      p_customer_id: state.customerId,
      p_discounts: [],
      p_notes: null,
    });
    expect(forged.error?.message).toContain("USE_CREATE_CREDIT_SALE");
  });

  it("serializa dos cajas y nunca rebasa el límite global", async () => {
    const variantA = await createVariant("Crédito paralelo A", 20000);
    const variantB = await createVariant("Crédito paralelo B", 20000);
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const makeInput = (session: string, variant: string) => ({
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: session,
      p_items: [{ variant_id: variant, quantity: 1 }],
      p_payments: [{ method_code: "CREDIT", amount_cents: 20000 }],
      p_customer_id: state.customerId,
      p_due_date: due,
      p_discounts: [],
      p_notes: null,
    });
    const results = await Promise.all([
      state.cashierA!.client.rpc(
        "create_credit_sale",
        makeInput(state.sessionA, variantA),
      ),
      state.cashierB!.client.rpc(
        "create_credit_sale",
        makeInput(state.sessionB, variantB),
      ),
    ]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(results.find((result) => result.error)?.error?.message).toContain(
      "CREDIT_LIMIT_EXCEEDED",
    );
    const summary = await state.cashierA!.client.rpc(
      "get_customer_credit_summary",
      { p_customer_id: state.customerId },
    );
    expect(summary.data.balance_cents).toBe(20000);
  });

  it("registra un abono mixto una sola vez y sólo el efectivo entra a caja", async () => {
    const key = crypto.randomUUID();
    const input = {
      p_idempotency_key: key,
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_payments: [
        { method_code: "CASH", amount_cents: 5000, tendered_cents: 5000 },
        { method_code: "CARD", amount_cents: 5000, reference: "TERM-123" },
      ],
      p_note: "Abono mixto de prueba",
    };
    const first = await state.cashierA!.client.rpc(
      "record_customer_credit_payment",
      input,
    );
    const retry = await state.cashierA!.client.rpc(
      "record_customer_credit_payment",
      input,
    );
    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data.id).toBe(first.data.id);
    expect(retry.data.balance_cents).toBe(10000);
    const cash = await state
      .server!.from("cash_movements")
      .select("amount_cents")
      .eq("reference_type", "CREDIT_PAYMENT")
      .eq("reference_id", first.data.id);
    expect(cash.data).toEqual([{ amount_cents: 5000 }]);
    const statement = await state.cashierA!.client.rpc(
      "get_customer_credit_statement",
      { p_customer_id: state.customerId },
    );
    expect(statement.error).toBeNull();
    expect(statement.data.balance_cents).toBe(10000);
  });

  it("mantiene comprobantes y asignaciones fuera del acceso directo", async () => {
    expect(
      (await state.admin!.client.from("customer_credit_payments").select("id"))
        .error,
    ).not.toBeNull();
    const forged = await state
      .server!.from("customer_credit_allocations")
      .insert({
        payment_ledger_id: crypto.randomUUID(),
        charge_ledger_id: crypto.randomUUID(),
        amount_cents: 100,
      });
    expect(forged.error?.message).toContain(
      "DIRECT_CREDIT_PAYMENT_WRITE_FORBIDDEN",
    );
  });
});
