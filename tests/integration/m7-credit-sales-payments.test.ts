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
  adminSession: "",
  customerId: "",
  adminEmployeeCode: "",
  creditSaleId: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function dateInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

async function clientInTimezone(source: SupabaseClient, timeZone: string) {
  const current = await source.auth.getSession();
  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Prefer: `timezone=${timeZone}` } },
  });
  const session = current.data.session;
  expect(session).not.toBeNull();
  expect(
    (
      await client.auth.setSession({
        access_token: session!.access_token,
        refresh_token: session!.refresh_token,
      })
    ).error,
  ).toBeNull();
  return client;
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
      const employeeCode = `CV${definition.key.toUpperCase()}${runCode}`;
      expect(
        (
          await server.from("app_users").insert({
            id,
            employee_code: employeeCode,
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
      if (definition.key === "admin") state.adminEmployeeCode = employeeCode;
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
    const registerAdmin = await state.admin!.client.rpc(
      "create_cash_register",
      {
        p_location_id: state.locationId,
        p_code: "CAJA03",
        p_name: "Caja administrativa",
      },
    );
    const [openA, openB, openAdmin] = await Promise.all([
      state.cashierA!.client.rpc("open_cash_session", {
        p_register_id: registerA.data.id,
        p_opening_amount_cents: 10000,
      }),
      state.cashierB!.client.rpc("open_cash_session", {
        p_register_id: registerB.data.id,
        p_opening_amount_cents: 10000,
      }),
      state.admin!.client.rpc("open_cash_session", {
        p_register_id: registerAdmin.data.id,
        p_opening_amount_cents: 20000,
      }),
    ]);
    expect(openA.error).toBeNull();
    expect(openB.error).toBeNull();
    state.sessionA = openA.data.id;
    state.sessionB = openB.data.id;
    expect(openAdmin.error).toBeNull();
    state.adminSession = openAdmin.data.id;

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
    state.creditSaleId = results.find((result) => !result.error)!.data.id;
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
    const receipt = await state.cashierA!.client.rpc(
      "get_customer_credit_payment_receipt",
      { p_payment_id: first.data.id },
    );
    expect(receipt.error).toBeNull();
    expect(receipt.data).toMatchObject({
      id: first.data.id,
      total_cents: 10000,
      balance_cents: 10000,
      customer_name: expect.any(String),
      folio: expect.stringMatching(/-A-\d{6}$/),
    });
    expect(receipt.data.parts).toEqual([
      expect.objectContaining({ method_code: "CASH", amount_cents: 5000 }),
      expect.objectContaining({ method_code: "CARD", amount_cents: 5000 }),
    ]);
  });

  it("reduce primero la deuda y sólo devuelve el dinero realmente abonado", async () => {
    expect(
      (
        await state.admin!.client.rpc("update_my_profile", {
          p_full_name: null,
          p_new_pin: "7319",
        })
      ).error,
    ).toBeNull();
    const authorization = await state.cashierA!.client.rpc(
      "verify_supervisor_pin",
      {
        p_employee_code: state.adminEmployeeCode,
        p_pin: "7319",
        p_permission: "returns.authorize",
      },
    );
    expect(authorization.error).toBeNull();
    const item = await state
      .server!.from("sale_items")
      .select("id")
      .eq("sale_id", state.creditSaleId)
      .single();
    expect(item.error).toBeNull();

    const returned = await state.cashierA!.client.rpc(
      "create_return_exchange",
      {
        p_idempotency_key: crypto.randomUUID(),
        p_cash_session_id: state.sessionA,
        p_original_sale_id: state.creditSaleId,
        p_items_in: [
          {
            sale_item_id: item.data!.id,
            quantity: 1,
            condition: "RESELLABLE",
          },
        ],
        p_items_out: [],
        p_charge_payments: [],
        p_refund_references: [
          { method_code: "CARD", reference: "DEV-CREDITO-001" },
        ],
        p_authorization_token: authorization.data.authorization_token,
        p_reason: "Devolución de venta con abono parcial",
      },
    );
    expect(returned.error).toBeNull();
    expect(returned.data.credit_settlement).toEqual({
      debt_reduction_cents: 10000,
      paid_refund_cents: 10000,
    });
    expect(returned.data.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method_code: "CASH", amount_cents: 5000 }),
        expect.objectContaining({ method_code: "CARD", amount_cents: 5000 }),
      ]),
    );
    expect(returned.data.payments).toHaveLength(2);
    const summary = await state.cashierA!.client.rpc(
      "get_customer_credit_summary",
      { p_customer_id: state.customerId },
    );
    expect(summary.data.balance_cents).toBe(0);
    const statement = await state.cashierA!.client.rpc(
      "get_customer_credit_statement",
      { p_customer_id: state.customerId },
    );
    expect(
      statement.data.entries.some(
        (entry: { entry_type: string; amount_cents: number }) =>
          entry.entry_type === "RETURN" && entry.amount_cents === -10000,
      ),
    ).toBe(true);
  });

  it("no permite que la cancelación anterior deje una deuda huérfana", async () => {
    const variantId = await createVariant(
      "Crédito protegido al cancelar",
      8000,
    );
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const sale = await state.cashierA!.client.rpc("create_credit_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_payments: [{ method_code: "CREDIT", amount_cents: 8000 }],
      p_customer_id: state.customerId,
      p_due_date: due,
      p_discounts: [],
      p_notes: null,
    });
    expect(sale.error).toBeNull();
    const cancelled = await state.admin!.client.rpc("cancel_sale", {
      p_sale_id: sale.data.id,
      p_reason: "No debe dejar deuda huérfana",
    });
    expect(cancelled.error?.message).toContain(
      "CREDIT_CANCELLATION_REQUIRES_RETURN",
    );
    const persisted = await state
      .server!.from("sales")
      .select("status")
      .eq("id", sale.data.id)
      .single();
    expect(persisted.data?.status).toBe("COMPLETED");
  });

  it("una devolución totalmente pendiente no entrega dinero", async () => {
    const variantId = await createVariant("Crédito sin abono", 10000);
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const sale = await state.cashierA!.client.rpc("create_credit_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_payments: [{ method_code: "CREDIT", amount_cents: 10000 }],
      p_customer_id: state.customerId,
      p_due_date: due,
      p_discounts: [],
      p_notes: null,
    });
    expect(sale.error).toBeNull();
    const item = await state
      .server!.from("sale_items")
      .select("id")
      .eq("sale_id", sale.data.id)
      .single();
    const authorization = await state.cashierA!.client.rpc(
      "verify_supervisor_pin",
      {
        p_employee_code: state.adminEmployeeCode,
        p_pin: "7319",
        p_permission: "returns.authorize",
      },
    );
    const returned = await state.cashierA!.client.rpc(
      "create_return_exchange",
      {
        p_idempotency_key: crypto.randomUUID(),
        p_cash_session_id: state.sessionA,
        p_original_sale_id: sale.data.id,
        p_items_in: [
          {
            sale_item_id: item.data!.id,
            quantity: 1,
            condition: "RESELLABLE",
          },
        ],
        p_items_out: [],
        p_charge_payments: [],
        p_refund_references: [],
        p_authorization_token: authorization.data.authorization_token,
        p_reason: "Devolución sin dinero recibido",
      },
    );
    expect(returned.error).toBeNull();
    expect(returned.data.credit_settlement).toEqual({
      debt_reduction_cents: 10000,
      paid_refund_cents: 0,
    });
    expect(returned.data.payments).toEqual([]);

    const paid = await state.cashierA!.client.rpc(
      "record_customer_credit_payment",
      {
        p_idempotency_key: crypto.randomUUID(),
        p_cash_session_id: state.sessionA,
        p_customer_id: state.customerId,
        p_payments: [
          { method_code: "CARD", amount_cents: 8000, reference: "ABONO-008" },
        ],
        p_note: "Liquida el único cargo que sigue abierto",
      },
    );
    expect(paid.error).toBeNull();
    const finalSummary = await state.cashierA!.client.rpc(
      "get_customer_credit_summary",
      { p_customer_id: state.customerId },
    );
    expect(finalSummary.data.balance_cents).toBe(0);
    expect(finalSummary.data.oldest_due_date).toBeNull();
  });

  it("cancela una venta a crédito con un documento compensatorio idempotente", async () => {
    const cashierCancelPermission = await state
      .server!.from("role_permissions")
      .select("permission_code")
      .eq(
        "role_id",
        (
          await state
            .server!.from("app_users")
            .select("role_id")
            .eq("id", state.cashierA!.id)
            .single()
        ).data!.role_id,
      )
      .eq("permission_code", "sales.cancel")
      .maybeSingle();
    expect(cashierCancelPermission.data).toBeNull();
    const variantId = await createVariant("Crédito cancelado completo", 10000);
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const sale = await state.cashierA!.client.rpc("create_credit_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_payments: [
        { method_code: "CASH", amount_cents: 3000, tendered_cents: 3000 },
        { method_code: "CREDIT", amount_cents: 7000 },
      ],
      p_customer_id: state.customerId,
      p_due_date: due,
      p_discounts: [],
      p_notes: null,
    });
    expect(sale.error).toBeNull();

    const authorization = await state.cashierA!.client.rpc(
      "verify_supervisor_pin",
      {
        p_employee_code: state.adminEmployeeCode,
        p_pin: "7319",
        p_permission: "returns.authorize",
      },
    );
    expect(authorization.error).toBeNull();
    const key = crypto.randomUUID();
    const input = {
      p_idempotency_key: key,
      p_cash_session_id: state.sessionA,
      p_sale_id: sale.data.id,
      p_refund_references: [],
      p_authorization_token: authorization.data.authorization_token,
      p_reason: "Cancelación completa autorizada",
    };
    const cancelled = await state.cashierA!.client.rpc(
      "cancel_credit_sale",
      input,
    );
    const retry = await state.cashierA!.client.rpc("cancel_credit_sale", input);
    expect(cancelled.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data.id).toBe(cancelled.data.id);
    expect(cancelled.data.credit_settlement).toEqual({
      debt_reduction_cents: 7000,
      paid_refund_cents: 3000,
    });

    const persisted = await state
      .server!.from("sales")
      .select("status,cancellation_reason")
      .eq("id", sale.data.id)
      .single();
    expect(persisted.data).toMatchObject({
      status: "CANCELLED",
      cancellation_reason: "Cancelación completa autorizada",
    });
    const inventory = await state
      .server!.from("inventory_by_location")
      .select("qty")
      .eq("variant_id", variantId)
      .eq("location_id", state.locationId)
      .single();
    expect(Number(inventory.data?.qty)).toBe(2);
    const refundCash = await state
      .server!.from("cash_movements")
      .select("amount_cents")
      .eq("session_id", state.sessionA)
      .eq("reference_type", "RETURN")
      .eq("reference_id", cancelled.data.id);
    expect(refundCash.data).toEqual([{ amount_cents: -3000 }]);
    const duplicateReturns = await state
      .server!.from("returns")
      .select("id")
      .eq("original_sale_id", sale.data.id);
    expect(duplicateReturns.data).toHaveLength(1);
  });

  it("permite apartar sin enganche, reserva la última existencia y no mueve caja", async () => {
    const variantId = await createVariant("Apartado sin enganche", 12500);
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const key = crypto.randomUUID();
    const input = {
      p_idempotency_key: key,
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: due,
      p_items: [{ variant_id: variantId, quantity: 2 }],
      p_notes: "Prueba de reserva real",
    };
    const beforeCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionA);
    const created = await state.cashierA!.client.rpc("create_layaway", input);
    const retry = await state.cashierA!.client.rpc("create_layaway", input);
    expect(created.error).toBeNull();
    expect(created.data.folio).toContain("-A-");
    expect(retry.error).toBeNull();
    expect(retry.data.id).toBe(created.data.id);
    expect(created.data).toMatchObject({
      status: "OPEN",
      total_cents: 25000,
      paid_cents: 0,
      balance_cents: 25000,
    });

    const inventory = await state
      .server!.from("inventory_by_location")
      .select("qty,reserved_qty")
      .eq("variant_id", variantId)
      .eq("location_id", state.locationId)
      .single();
    expect(inventory.data).toMatchObject({ qty: 2, reserved_qty: 2 });
    const afterCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionA);
    expect(afterCash.count).toBe(beforeCash.count);

    const sale = await state.cashierB!.client.rpc("create_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionB,
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_payments: [
        { method_code: "CASH", amount_cents: 12500, tendered_cents: 12500 },
      ],
      p_customer_id: null,
      p_discounts: [],
      p_notes: null,
    });
    expect(sale.error?.message).toContain("INSUFFICIENT_STOCK");
    const directEdit = await state
      .server!.from("layaways")
      .update({ status: "CANCELLED" })
      .eq("id", created.data.id);
    expect(directEdit.error?.message).toContain("LAYAWAY_LEDGER_IMMUTABLE");
  });

  it("dos cajas no pueden apartar ambas las mismas dos piezas", async () => {
    const variantId = await createVariant("Apartado concurrente", 9000);
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const makeInput = (session: string) => ({
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: session,
      p_customer_id: state.customerId,
      p_due_date: due,
      p_items: [{ variant_id: variantId, quantity: 2 }],
      p_notes: null,
    });
    const attempts = await Promise.all([
      state.cashierA!.client.rpc("create_layaway", makeInput(state.sessionA)),
      state.cashierB!.client.rpc("create_layaway", makeInput(state.sessionB)),
    ]);
    expect(attempts.filter((attempt) => !attempt.error)).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.error)[0].error?.message,
    ).toContain("INSUFFICIENT_STOCK");
    const inventory = await state
      .server!.from("inventory_by_location")
      .select("qty,reserved_qty")
      .eq("variant_id", variantId)
      .eq("location_id", state.locationId)
      .single();
    expect(inventory.data).toMatchObject({ qty: 2, reserved_qty: 2 });
  });

  it("registra un abono mixto idempotente, mueve sólo efectivo y liquida el apartado", async () => {
    const variantId = await createVariant("Apartado con abonos", 10000);
    const created = await state.cashierA!.client.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      p_items: [{ variant_id: variantId, quantity: 2 }],
      p_notes: null,
    });
    expect(created.error).toBeNull();
    const key = crypto.randomUUID();
    const input = {
      p_idempotency_key: key,
      p_cash_session_id: state.sessionA,
      p_layaway_id: created.data.id,
      p_payments: [
        { method_code: "CASH", amount_cents: 5000, tendered_cents: 5000 },
        { method_code: "CARD", amount_cents: 15000, reference: "TAR-123" },
      ],
      p_note: "Liquidación de prueba",
    };
    const paid = await state.cashierA!.client.rpc(
      "record_layaway_payment",
      input,
    );
    const retry = await state.cashierA!.client.rpc(
      "record_layaway_payment",
      input,
    );
    expect(paid.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data.id).toBe(paid.data.id);
    expect(paid.data).toMatchObject({ total_cents: 20000, balance_cents: 0 });

    const layaway = await state
      .server!.from("layaways")
      .select("status,paid_cents,balance_cents")
      .eq("id", created.data.id)
      .single();
    expect(layaway.data).toMatchObject({
      status: "PAID",
      paid_cents: 20000,
      balance_cents: 0,
    });
    const cash = await state
      .server!.from("cash_movements")
      .select("amount_cents")
      .eq("reference_type", "LAYAWAY_PAYMENT")
      .eq("reference_id", paid.data.id);
    expect(cash.data).toEqual([{ amount_cents: 5000 }]);
    const receipt = await state.cashierA!.client.rpc(
      "get_layaway_payment_receipt",
      { p_payment_id: paid.data.id },
    );
    expect(receipt.error).toBeNull();
    expect(receipt.data.parts).toHaveLength(2);
    expect(receipt.data).toMatchObject({
      layaway_folio: created.data.folio,
      balance_cents: 0,
    });

    const overpay = await state.cashierA!.client.rpc("record_layaway_payment", {
      ...input,
      p_idempotency_key: crypto.randomUUID(),
      p_payments: [
        { method_code: "CASH", amount_cents: 100, tendered_cents: 100 },
      ],
    });
    expect(overpay.error?.message).toContain("LAYAWAY_NOT_PAYABLE");
  });

  it("entrega un apartado liquidado como venta sin volver a mover caja", async () => {
    const variantId = await createVariant("Entrega de apartado", 10000);
    const created = await state.cashierA!.client.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      p_items: [{ variant_id: variantId, quantity: 2 }],
      p_notes: "Entrega operativa",
    });
    expect(created.error).toBeNull();
    const paid = await state.cashierA!.client.rpc("record_layaway_payment", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_layaway_id: created.data.id,
      p_payments: [
        { method_code: "CASH", amount_cents: 5000, tendered_cents: 5000 },
        { method_code: "CARD", amount_cents: 15000, reference: "ENT-123" },
      ],
      p_note: "Liquidación antes de entrega",
    });
    expect(paid.error).toBeNull();
    const beforeCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionA);

    const key = crypto.randomUUID();
    const input = {
      p_operation_key: key,
      p_cash_session_id: state.sessionA,
      p_layaway_id: created.data.id,
    };
    const delivered = await state.cashierA!.client.rpc(
      "fulfill_layaway",
      input,
    );
    const retry = await state.cashierA!.client.rpc("fulfill_layaway", input);
    expect(delivered.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data.sale_id).toBe(delivered.data.sale_id);
    expect(delivered.data.sale_folio).toContain("-V-");

    const layaway = await state
      .server!.from("layaways")
      .select("status,completed_at")
      .eq("id", created.data.id)
      .single();
    expect(layaway.data?.status).toBe("COMPLETED");
    expect(layaway.data?.completed_at).not.toBeNull();
    const sale = await state
      .server!.from("sales")
      .select("status,total_cents,customer_id")
      .eq("id", delivered.data.sale_id)
      .single();
    expect(sale.data).toMatchObject({
      status: "COMPLETED",
      total_cents: 20000,
      customer_id: state.customerId,
    });
    const payments = await state
      .server!.from("sale_payments")
      .select("method_code,amount_cents")
      .eq("sale_id", delivered.data.sale_id)
      .order("method_code");
    expect(payments.data).toEqual([
      { method_code: "CARD", amount_cents: 15000 },
      { method_code: "CASH", amount_cents: 5000 },
    ]);
    const inventory = await state
      .server!.from("inventory_by_location")
      .select("qty,reserved_qty")
      .eq("variant_id", variantId)
      .eq("location_id", state.locationId)
      .single();
    expect(inventory.data).toMatchObject({ qty: 0, reserved_qty: 0 });
    const afterCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionA);
    expect(afterCash.count).toBe(beforeCash.count);
    const receipt = await state.cashierA!.client.rpc("get_sale_receipt", {
      p_sale_id: delivered.data.sale_id,
    });
    expect(receipt.error).toBeNull();
    expect(receipt.data).toMatchObject({
      folio: delivered.data.sale_folio,
      total_cents: 20000,
    });
  });

  it("serializa dos intentos de entrega y crea una sola venta", async () => {
    const variantId = await createVariant("Entrega simultánea", 8000);
    const created = await state.cashierA!.client.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_notes: null,
    });
    expect(created.error).toBeNull();
    expect(
      (
        await state.cashierA!.client.rpc("record_layaway_payment", {
          p_idempotency_key: crypto.randomUUID(),
          p_cash_session_id: state.sessionA,
          p_layaway_id: created.data.id,
          p_payments: [
            {
              method_code: "TRANSFER",
              amount_cents: 8000,
              reference: "SIM-ENT-1",
            },
          ],
          p_note: null,
        })
      ).error,
    ).toBeNull();
    const secondConnection = await clientInTimezone(
      state.cashierA!.client,
      "UTC",
    );
    const attempts = await Promise.all([
      state.cashierA!.client.rpc("fulfill_layaway", {
        p_operation_key: crypto.randomUUID(),
        p_cash_session_id: state.sessionA,
        p_layaway_id: created.data.id,
      }),
      secondConnection.rpc("fulfill_layaway", {
        p_operation_key: crypto.randomUUID(),
        p_cash_session_id: state.sessionA,
        p_layaway_id: created.data.id,
      }),
    ]);
    expect(attempts.filter((attempt) => !attempt.error)).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.error)?.error?.message).toContain(
      "LAYAWAY_ALREADY_FULFILLED",
    );
    const fulfillments = await state
      .server!.from("layaway_fulfillments")
      .select("sale_id")
      .eq("layaway_id", created.data.id);
    expect(fulfillments.data).toHaveLength(1);
    const movements = await state
      .server!.from("inventory_movements")
      .select("id")
      .eq("reference_type", "SALE")
      .eq("reference_id", fulfillments.data![0].sale_id)
      .eq("variant_id", variantId);
    expect(movements.data).toHaveLength(1);
  });

  it("autoriza un solo crédito vencido, conserva el atraso y permite reintento idempotente", async () => {
    const westZone = "Etc/GMT+12";
    const eastZone = "Pacific/Kiritimati";
    const westCashier = await clientInTimezone(
      state.cashierA!.client,
      westZone,
    );
    const eastCashier = await clientInTimezone(
      state.cashierA!.client,
      eastZone,
    );
    const overdueVariant = await createVariant("Crédito que vence", 5000);
    const firstSale = await westCashier.rpc("create_credit_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_items: [{ variant_id: overdueVariant, quantity: 1 }],
      p_payments: [{ method_code: "CREDIT", amount_cents: 5000 }],
      p_customer_id: state.customerId,
      p_due_date: dateInZone(westZone),
      p_discounts: [],
      p_notes: null,
    });
    expect(firstSale.error).toBeNull();

    const summary = await eastCashier.rpc("get_customer_credit_summary", {
      p_customer_id: state.customerId,
    });
    expect(summary.error).toBeNull();
    expect(summary.data.has_overdue).toBe(true);

    const normalAttemptVariant = await createVariant(
      "Crédito normal bloqueado",
      4000,
    );
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const normalAttempt = await eastCashier.rpc("create_credit_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_items: [{ variant_id: normalAttemptVariant, quantity: 1 }],
      p_payments: [{ method_code: "CREDIT", amount_cents: 4000 }],
      p_customer_id: state.customerId,
      p_due_date: due,
      p_discounts: [],
      p_notes: null,
    });
    expect(normalAttempt.error?.message).toContain("CREDIT_OVERDUE");

    const authorization = await eastCashier.rpc("verify_supervisor_pin", {
      p_employee_code: state.adminEmployeeCode,
      p_pin: "7319",
      p_permission: "credit.override",
    });
    expect(authorization.error).toBeNull();
    expect(authorization.data.status).toBe("AUTHORIZED");

    const key = crypto.randomUUID();
    const input = {
      p_idempotency_key: key,
      p_cash_session_id: state.sessionA,
      p_items: [{ variant_id: normalAttemptVariant, quantity: 1 }],
      p_payments: [{ method_code: "CREDIT", amount_cents: 4000 }],
      p_customer_id: state.customerId,
      p_due_date: due,
      p_overdue_authorization_token: authorization.data.authorization_token,
      p_override_reason: "Excepción única autorizada para prueba",
      p_discounts: [],
      p_notes: null,
    };
    const allowed = await eastCashier.rpc("create_overdue_credit_sale", input);
    const retry = await eastCashier.rpc("create_overdue_credit_sale", input);
    expect(allowed.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data.id).toBe(allowed.data.id);

    const reused = await eastCashier.rpc("create_overdue_credit_sale", {
      ...input,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(reused.error?.message).toContain("CREDIT_OVERDUE_OVERRIDE_REQUIRED");

    const audit = await state
      .server!.from("audit_log")
      .select("metadata")
      .eq("action", "customer_credit.overdue_exception_used")
      .eq("entity_id", allowed.data.id)
      .single();
    expect(audit.error).toBeNull();
    expect(audit.data?.metadata).toMatchObject({
      customer_id: state.customerId,
      credit_cents: 4000,
      overdue_balance_cents: 5000,
    });
    expect(
      (
        await eastCashier.rpc("get_customer_credit_summary", {
          p_customer_id: state.customerId,
        })
      ).data.has_overdue,
    ).toBe(true);
  });

  it("cancela un apartado vencido una sola vez, retiene lo abonado y libera la reserva", async () => {
    const westZone = "Etc/GMT+12";
    const eastZone = "Pacific/Kiritimati";
    const westCashier = await clientInTimezone(
      state.cashierA!.client,
      westZone,
    );
    const eastCashier = await clientInTimezone(
      state.cashierA!.client,
      eastZone,
    );
    const variantId = await createVariant("Apartado vencido", 10000);
    const created = await westCashier.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: dateInZone(westZone),
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_notes: "Se cancelará al vencer",
    });
    expect(created.error).toBeNull();
    const paid = await westCashier.rpc("record_layaway_payment", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_layaway_id: created.data.id,
      p_payments: [
        { method_code: "CASH", amount_cents: 3000, tendered_cents: 3000 },
      ],
      p_note: "Abono que se retiene como penalización",
    });
    expect(paid.error).toBeNull();
    const beforeCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionA);

    const key = crypto.randomUUID();
    const input = {
      p_idempotency_key: key,
      p_layaway_id: created.data.id,
      p_reason: "Cliente no liquidó el apartado vencido",
    };
    const cancelled = await eastCashier.rpc("cancel_overdue_layaway", input);
    const retry = await eastCashier.rpc("cancel_overdue_layaway", input);
    expect(cancelled.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data).toEqual(cancelled.data);
    expect(cancelled.data).toMatchObject({
      id: created.data.id,
      status: "CANCELLED",
      penalty_cents: 3000,
      released_balance_cents: 7000,
    });

    const layaway = await state
      .server!.from("layaways")
      .select(
        "status,paid_cents,balance_cents,cancellation_penalty_cents,cancelled_balance_cents,cancellation_reason",
      )
      .eq("id", created.data.id)
      .single();
    expect(layaway.data).toMatchObject({
      status: "CANCELLED",
      paid_cents: 3000,
      balance_cents: 7000,
      cancellation_penalty_cents: 3000,
      cancelled_balance_cents: 7000,
      cancellation_reason: "Cliente no liquidó el apartado vencido",
    });
    const inventory = await state
      .server!.from("inventory_by_location")
      .select("qty,reserved_qty")
      .eq("variant_id", variantId)
      .eq("location_id", state.locationId)
      .single();
    expect(inventory.data).toMatchObject({ qty: 2, reserved_qty: 0 });
    const releases = await state
      .server!.from("inventory_reservation_movements")
      .select("movement_type,quantity")
      .eq("operation_key", key);
    expect(releases.data).toEqual([{ movement_type: "RELEASE", quantity: -1 }]);
    const afterCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionA);
    expect(afterCash.count).toBe(beforeCash.count);

    const secondCancellation = await eastCashier.rpc("cancel_overdue_layaway", {
      ...input,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(secondCancellation.error?.message).toContain(
      "LAYAWAY_NOT_CANCELLABLE",
    );
  });

  it("bloquea cancelar antes del vencimiento hasta definir la devolución", async () => {
    const variantId = await createVariant("Apartado vigente", 6000);
    const created = await state.cashierA!.client.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_notes: null,
    });
    expect(created.error).toBeNull();
    const cancellation = await state.cashierA!.client.rpc(
      "cancel_overdue_layaway",
      {
        p_idempotency_key: crypto.randomUUID(),
        p_layaway_id: created.data.id,
        p_reason: "Intento antes de vencer",
      },
    );
    expect(cancellation.error?.message).toContain(
      "LAYAWAY_CANCELLATION_POLICY_UNDEFINED",
    );
    const inventory = await state
      .server!.from("inventory_by_location")
      .select("reserved_qty")
      .eq("variant_id", variantId)
      .eq("location_id", state.locationId)
      .single();
    expect(inventory.data?.reserved_qty).toBe(1);
  });

  it("sustituye una línea una sola vez, mueve la reserva y conserva los abonos", async () => {
    const oldVariantId = await createVariant("Apartado a sustituir", 10000);
    const newVariantId = await createVariant("Reemplazo de apartado", 15000);
    const created = await state.cashierA!.client.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      p_items: [{ variant_id: oldVariantId, quantity: 1 }],
      p_notes: null,
    });
    expect(created.error).toBeNull();
    const payment = await state.cashierA!.client.rpc("record_layaway_payment", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_layaway_id: created.data.id,
      p_payments: [
        { method_code: "CASH", amount_cents: 3000, tendered_cents: 3000 },
      ],
      p_note: null,
    });
    expect(payment.error).toBeNull();
    const item = await state
      .server!.from("layaway_items")
      .select("id")
      .eq("layaway_id", created.data.id)
      .single();
    expect(item.error).toBeNull();
    const denied = await state.cashierA!.client.rpc("substitute_layaway_item", {
      p_operation_key: crypto.randomUUID(),
      p_layaway_id: created.data.id,
      p_layaway_item_id: item.data!.id,
      p_expected_variant_id: oldVariantId,
      p_new_variant_id: newVariantId,
      p_reason: "La cajera no debe cambiar productos",
    });
    expect(denied.error?.message).toContain("NOT_AUTHORIZED");

    const beforeCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionA);
    const key = crypto.randomUUID();
    const input = {
      p_operation_key: key,
      p_layaway_id: created.data.id,
      p_layaway_item_id: item.data!.id,
      p_expected_variant_id: oldVariantId,
      p_new_variant_id: newVariantId,
      p_reason: "El cliente solicitó otra talla",
    };
    const changed = await state.admin!.client.rpc(
      "substitute_layaway_item",
      input,
    );
    const retry = await state.admin!.client.rpc(
      "substitute_layaway_item",
      input,
    );
    expect(changed.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data).toEqual(changed.data);
    expect(changed.data).toMatchObject({
      old_variant_id: oldVariantId,
      new_variant_id: newVariantId,
      old_total_cents: 10000,
      new_total_cents: 15000,
      new_balance_cents: 12000,
    });

    const layaway = await state
      .server!.from("layaways")
      .select("status,total_cents,paid_cents,balance_cents")
      .eq("id", created.data.id)
      .single();
    expect(layaway.data).toMatchObject({
      status: "PARTIALLY_PAID",
      total_cents: 15000,
      paid_cents: 3000,
      balance_cents: 12000,
    });
    const updatedItem = await state
      .server!.from("layaway_items")
      .select("variant_id,unit_price_cents,line_total_cents")
      .eq("id", item.data!.id)
      .single();
    expect(updatedItem.data).toMatchObject({
      variant_id: newVariantId,
      unit_price_cents: 15000,
      line_total_cents: 15000,
    });
    const inventory = await state
      .server!.from("inventory_by_location")
      .select("variant_id,qty,reserved_qty")
      .in("variant_id", [oldVariantId, newVariantId])
      .eq("location_id", state.locationId)
      .order("variant_id");
    const stock = new Map(
      (inventory.data ?? []).map((row) => [row.variant_id, row]),
    );
    expect(stock.get(oldVariantId)).toMatchObject({ qty: 2, reserved_qty: 0 });
    expect(stock.get(newVariantId)).toMatchObject({ qty: 2, reserved_qty: 1 });
    const movements = await state
      .server!.from("inventory_reservation_movements")
      .select("variant_id,movement_type,quantity")
      .eq("operation_key", key)
      .order("movement_type");
    expect(movements.data).toEqual(
      expect.arrayContaining([
        {
          variant_id: oldVariantId,
          movement_type: "RELEASE",
          quantity: -1,
        },
        {
          variant_id: newVariantId,
          movement_type: "RESERVE",
          quantity: 1,
        },
      ]),
    );
    const afterCash = await state
      .server!.from("cash_movements")
      .select("id", { count: "exact", head: true })
      .eq("session_id", state.sessionA);
    expect(afterCash.count).toBe(beforeCash.count);
    const stale = await state.admin!.client.rpc("substitute_layaway_item", {
      ...input,
      p_operation_key: crypto.randomUUID(),
    });
    expect(stale.error?.message).toContain("LAYAWAY_ITEM_CHANGED");
  });

  it("rechaza una sustitución que requeriría devolver dinero y no mueve inventario", async () => {
    const oldVariantId = await createVariant("Apartado con abono alto", 10000);
    const cheapVariantId = await createVariant("Reemplazo más barato", 2000);
    const created = await state.cashierA!.client.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      p_items: [{ variant_id: oldVariantId, quantity: 1 }],
      p_notes: null,
    });
    expect(created.error).toBeNull();
    expect(
      (
        await state.cashierA!.client.rpc("record_layaway_payment", {
          p_idempotency_key: crypto.randomUUID(),
          p_cash_session_id: state.sessionA,
          p_layaway_id: created.data.id,
          p_payments: [
            {
              method_code: "CARD",
              amount_cents: 5000,
              reference: "ABONO-ALTO-1",
            },
          ],
          p_note: null,
        })
      ).error,
    ).toBeNull();
    const item = await state
      .server!.from("layaway_items")
      .select("id")
      .eq("layaway_id", created.data.id)
      .single();
    const rejected = await state.admin!.client.rpc("substitute_layaway_item", {
      p_operation_key: crypto.randomUUID(),
      p_layaway_id: created.data.id,
      p_layaway_item_id: item.data!.id,
      p_expected_variant_id: oldVariantId,
      p_new_variant_id: cheapVariantId,
      p_reason: "No debe inventar una devolución",
    });
    expect(rejected.error?.message).toContain(
      "LAYAWAY_SUBSTITUTION_REFUND_UNDEFINED",
    );
    const layaway = await state
      .server!.from("layaways")
      .select("total_cents,paid_cents,balance_cents")
      .eq("id", created.data.id)
      .single();
    expect(layaway.data).toMatchObject({
      total_cents: 10000,
      paid_cents: 5000,
      balance_cents: 5000,
    });
    const inventory = await state
      .server!.from("inventory_by_location")
      .select("variant_id,reserved_qty")
      .in("variant_id", [oldVariantId, cheapVariantId])
      .eq("location_id", state.locationId);
    const stock = new Map(
      (inventory.data ?? []).map((row) => [row.variant_id, row.reserved_qty]),
    );
    expect(stock.get(oldVariantId)).toBe(1);
    expect(stock.get(cheapVariantId)).toBe(0);
  });

  it("serializa dos sustituciones simultáneas y reserva un solo reemplazo", async () => {
    const oldVariantId = await createVariant("Cambio simultáneo origen", 7000);
    const replacementA = await createVariant("Cambio simultáneo A", 8000);
    const replacementB = await createVariant("Cambio simultáneo B", 9000);
    const created = await state.cashierA!.client.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      p_items: [{ variant_id: oldVariantId, quantity: 1 }],
      p_notes: null,
    });
    expect(created.error).toBeNull();
    const item = await state
      .server!.from("layaway_items")
      .select("id")
      .eq("layaway_id", created.data.id)
      .single();
    const secondAdminConnection = await clientInTimezone(
      state.admin!.client,
      "UTC",
    );
    const makeInput = (newVariantId: string) => ({
      p_operation_key: crypto.randomUUID(),
      p_layaway_id: created.data.id,
      p_layaway_item_id: item.data!.id,
      p_expected_variant_id: oldVariantId,
      p_new_variant_id: newVariantId,
      p_reason: "Prueba de sustitución simultánea",
    });
    const results = await Promise.all([
      state.admin!.client.rpc(
        "substitute_layaway_item",
        makeInput(replacementA),
      ),
      secondAdminConnection.rpc(
        "substitute_layaway_item",
        makeInput(replacementB),
      ),
    ]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(results.find((result) => result.error)?.error?.message).toContain(
      "LAYAWAY_ITEM_CHANGED",
    );
    const inventory = await state
      .server!.from("inventory_by_location")
      .select("variant_id,reserved_qty")
      .in("variant_id", [oldVariantId, replacementA, replacementB])
      .eq("location_id", state.locationId);
    const stock = new Map(
      (inventory.data ?? []).map((row) => [row.variant_id, row.reserved_qty]),
    );
    expect(stock.get(oldVariantId)).toBe(0);
    expect(
      Number(stock.get(replacementA)) + Number(stock.get(replacementB)),
    ).toBe(1);
  });

  it("cancela un apartado vigente con devolución proporcional e idempotente", async () => {
    const variantId = await createVariant("Cancelación anticipada", 10000);
    const created = await state.admin!.client.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.adminSession,
      p_customer_id: state.customerId,
      p_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_notes: null,
    });
    expect(created.error).toBeNull();
    expect(
      (
        await state.admin!.client.rpc("record_layaway_payment", {
          p_idempotency_key: crypto.randomUUID(),
          p_cash_session_id: state.adminSession,
          p_layaway_id: created.data.id,
          p_payments: [
            {
              method_code: "CASH",
              amount_cents: 6000,
              tendered_cents: 6000,
            },
            {
              method_code: "CARD",
              amount_cents: 4000,
              reference: "APARTADO-TARJETA-1",
            },
          ],
          p_note: null,
        })
      ).error,
    ).toBeNull();

    const key = crypto.randomUUID();
    const input = {
      p_operation_key: key,
      p_cash_session_id: state.adminSession,
      p_layaway_id: created.data.id,
      p_refund_cents: 5000,
      p_refund_references: [
        { method_code: "CARD", reference: "DEV-TARJETA-1" },
      ],
      p_reason: "Excepción autorizada por gerencia",
    };
    const cancelled = await state.admin!.client.rpc(
      "cancel_active_layaway",
      input,
    );
    const retry = await state.admin!.client.rpc("cancel_active_layaway", input);
    expect(cancelled.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data).toEqual(cancelled.data);
    expect(cancelled.data).toMatchObject({
      refund_cents: 5000,
      penalty_cents: 5000,
      released_balance_cents: 0,
    });
    expect(cancelled.data.refunds).toEqual(
      expect.arrayContaining([
        { method_code: "CASH", amount_cents: 3000, reference: null },
        {
          method_code: "CARD",
          amount_cents: 2000,
          reference: "DEV-TARJETA-1",
        },
      ]),
    );
    const layaway = await state
      .server!.from("layaways")
      .select(
        "status,cancellation_refund_cents,cancellation_penalty_cents,cancelled_balance_cents",
      )
      .eq("id", created.data.id)
      .single();
    expect(layaway.data).toMatchObject({
      status: "CANCELLED",
      cancellation_refund_cents: 5000,
      cancellation_penalty_cents: 5000,
      cancelled_balance_cents: 0,
    });
    const stock = await state
      .server!.from("inventory_by_location")
      .select("reserved_qty")
      .eq("location_id", state.locationId)
      .eq("variant_id", variantId)
      .single();
    expect(stock.data?.reserved_qty).toBe(0);
    const cash = await state
      .server!.from("cash_movements")
      .select("amount_cents")
      .eq("session_id", state.adminSession)
      .eq("reference_type", "LAYAWAY_CANCELLATION")
      .eq("reference_id", cancelled.data.id);
    expect(cash.data).toEqual([{ amount_cents: -3000 }]);
  });

  it("rechaza permisos insuficientes y revierte si la caja no cubre el efectivo", async () => {
    const variantId = await createVariant("Cancelación sin efectivo", 50000);
    const created = await state.cashierA!.client.rpc("create_layaway", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_customer_id: state.customerId,
      p_due_date: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_notes: null,
    });
    expect(created.error).toBeNull();
    expect(
      (
        await state.cashierA!.client.rpc("record_layaway_payment", {
          p_idempotency_key: crypto.randomUUID(),
          p_cash_session_id: state.sessionA,
          p_layaway_id: created.data.id,
          p_payments: [
            {
              method_code: "CASH",
              amount_cents: 50000,
              tendered_cents: 50000,
            },
          ],
          p_note: null,
        })
      ).error,
    ).toBeNull();
    const denied = await state.cashierA!.client.rpc("cancel_active_layaway", {
      p_operation_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionA,
      p_layaway_id: created.data.id,
      p_refund_cents: 1000,
      p_refund_references: [],
      p_reason: "La cajera no debe autorizar la excepción",
    });
    expect(denied.error?.message).toContain("NOT_AUTHORIZED");

    const insufficient = await state.admin!.client.rpc(
      "cancel_active_layaway",
      {
        p_operation_key: crypto.randomUUID(),
        p_cash_session_id: state.adminSession,
        p_layaway_id: created.data.id,
        p_refund_cents: 50000,
        p_refund_references: [],
        p_reason: "La caja administrativa no tiene el efectivo",
      },
    );
    expect(insufficient.error?.message).toContain("INSUFFICIENT_CASH");
    const layaway = await state
      .server!.from("layaways")
      .select("status")
      .eq("id", created.data.id)
      .single();
    expect(layaway.data?.status).toBe("PAID");
    const stock = await state
      .server!.from("inventory_by_location")
      .select("reserved_qty")
      .eq("location_id", state.locationId)
      .eq("variant_id", variantId)
      .single();
    expect(stock.data?.reserved_qty).toBe(1);
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
    expect(
      (
        await state
          .cashierA!.client.from("layaway_item_substitutions")
          .select("id")
      ).error,
    ).not.toBeNull();
    expect(
      (await state.cashierA!.client.from("layaway_cancellations").select("id"))
        .error,
    ).not.toBeNull();
  });
});
