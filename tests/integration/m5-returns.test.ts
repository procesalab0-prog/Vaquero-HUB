import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M5-2026!";
const runCode = Date.now().toString().slice(-8);

const state = {
  server: null as SupabaseClient | null,
  admin: null as SupabaseClient | null,
  adminId: "",
  locationId: "",
  sessionId: "",
  categoryId: "",
  lastReturnId: "",
};

async function createVariant(label: string, priceCents: number, stock: number) {
  const created = await state.admin!.rpc("create_catalog_product", {
    p_name: `${label} ${runCode} ${crypto.randomUUID().slice(0, 5)}`,
    p_category_id: state.categoryId,
    p_variants: [
      {
        cost_cents: Math.floor(priceCents / 2),
        price_cents: priceCents,
        attributes: {},
      },
    ],
  });
  expect(created.error).toBeNull();
  const productId = created.data.product_id as string;
  const variant = await state
    .server!.from("variants")
    .select("id")
    .eq("product_id", productId)
    .single();
  expect(variant.error).toBeNull();
  if (stock > 0) {
    const adjusted = await state.admin!.rpc("apply_inventory_adjustment", {
      p_variant_id: variant.data!.id,
      p_location_id: state.locationId,
      p_expected_qty: 0,
      p_counted_qty: stock,
      p_reason: "CONTEO_FISICO",
      p_note: "Preparación M5",
    });
    expect(adjusted.error).toBeNull();
  }
  return variant.data!.id as string;
}

async function createSale(
  variantId: string,
  quantity: number,
  totalCents: number,
  payments: Array<Record<string, unknown>> = [
    {
      method_code: "CASH",
      amount_cents: totalCents,
      tendered_cents: totalCents,
    },
  ],
) {
  const sale = await state.admin!.rpc("create_sale", {
    p_idempotency_key: crypto.randomUUID(),
    p_cash_session_id: state.sessionId,
    p_items: [{ variant_id: variantId, quantity }],
    p_payments: payments,
    p_customer_id: null,
    p_discounts: [],
    p_notes: null,
  });
  expect(sale.error).toBeNull();
  const item = await state
    .server!.from("sale_items")
    .select("id")
    .eq("sale_id", sale.data.id)
    .single();
  return {
    saleId: sale.data.id as string,
    saleItemId: item.data!.id as string,
    folio: sale.data.folio as string,
  };
}

async function authorizeReturn() {
  const result = await state.admin!.rpc("verify_supervisor_pin", {
    p_employee_code: `M5${runCode}`,
    p_pin: "5263",
    p_permission: "returns.authorize",
  });
  expect(result.error).toBeNull();
  expect(result.data.status).toBe("AUTHORIZED");
  return result.data.authorization_token as string;
}

async function stockOf(variantId: string) {
  const row = await state
    .server!.from("inventory_by_location")
    .select("qty")
    .eq("variant_id", variantId)
    .eq("location_id", state.locationId)
    .single();
  return Number(row.data?.qty ?? 0);
}

describe.sequential("M5: base de devoluciones y cambio parejo", () => {
  beforeAll(async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    state.server = server;
    const role = await server
      .from("roles")
      .select("id")
      .eq("code", "ADMIN")
      .single();
    const location = await server
      .from("locations")
      .insert({ code: `M5${runCode}`, name: "M5 Tienda", type: "STORE" })
      .select("id")
      .single();
    state.locationId = location.data!.id;
    const auth = await server.auth.admin.createUser({
      email: `m5-${runCode}@vaquero.test`,
      password,
      email_confirm: true,
    });
    state.adminId = auth.data.user!.id;
    await server.from("app_users").insert({
      id: state.adminId,
      employee_code: `M5${runCode}`,
      full_name: "M5 admin",
      email: `m5-${runCode}@vaquero.test`,
      role_id: role.data!.id,
    });
    await server
      .from("user_locations")
      .insert({ user_id: state.adminId, location_id: state.locationId });
    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    expect(
      (
        await client.auth.signInWithPassword({
          email: `m5-${runCode}@vaquero.test`,
          password,
        })
      ).error,
    ).toBeNull();
    state.admin = client;
    expect(
      (
        await client.rpc("update_my_profile", {
          p_full_name: null,
          p_new_pin: "5263",
        })
      ).error,
    ).toBeNull();
    const category = await server
      .from("categories")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    state.categoryId = category.data!.id;
    const register = await client.rpc("create_cash_register", {
      p_location_id: state.locationId,
      p_code: "CAJA01",
      p_name: "Caja 01",
    });
    const session = await client.rpc("open_cash_session", {
      p_register_id: register.data.id,
      p_opening_amount_cents: 100000,
    });
    state.sessionId = session.data.id;
  }, 30_000);

  it("registra un cambio parejo autorizado y conserva intacta la venta", async () => {
    const returnedVariant = await createVariant("Devuelto", 20000, 2);
    const deliveredVariant = await createVariant("Entregado", 20000, 2);
    const sale = await createSale(returnedVariant, 1, 20000);
    const original = await state.admin!.rpc("get_sale_receipt", {
      p_sale_id: sale.saleId,
    });
    const key = crypto.randomUUID();
    const input = {
      p_idempotency_key: key,
      p_cash_session_id: state.sessionId,
      p_original_sale_id: sale.saleId,
      p_items_in: [
        { sale_item_id: sale.saleItemId, quantity: 1, condition: "RESELLABLE" },
      ],
      p_items_out: [{ variant_id: deliveredVariant, quantity: 1 }],
      p_charge_payments: [],
      p_refund_references: [],
      p_authorization_token: await authorizeReturn(),
      p_reason: "Cambio de talla",
    };
    const created = await state.admin!.rpc("create_return_exchange", input);
    const repeated = await state.admin!.rpc("create_return_exchange", input);
    expect(created.error).toBeNull();
    expect(repeated.data.id).toBe(created.data.id);
    state.lastReturnId = created.data.id;
    expect(await stockOf(returnedVariant)).toBe(2);
    expect(await stockOf(deliveredVariant)).toBe(1);
    const after = await state.admin!.rpc("get_sale_receipt", {
      p_sale_id: sale.saleId,
    });
    expect(after.data).toEqual(original.data);
    const items = await state
      .server!.from("return_items")
      .select("direction,line_total_cents")
      .eq("return_id", created.data.id)
      .order("direction");
    expect(items.data).toEqual([
      { direction: "IN", line_total_cents: 20000 },
      { direction: "OUT", line_total_cents: 20000 },
    ]);
  });

  it("busca variantes disponibles aunque tengan otro precio", async () => {
    const returnedVariant = await createVariant("Buscar entrada", 18000, 1);
    const exactVariant = await createVariant("Buscar exacta", 18000, 2);
    const otherPriceVariant = await createVariant(
      "Buscar otro precio",
      19000,
      2,
    );
    const result = await state.admin!.rpc("search_exchange_variants", {
      p_exclude_variant_id: returnedVariant,
      p_query: "",
      p_limit: 100,
    });
    expect(result.error).toBeNull();
    const ids = (result.data ?? []).map(
      (row: { variant_id: string }) => row.variant_id,
    );
    expect(ids).toContain(exactVariant);
    expect(ids).not.toContain(returnedVariant);
    expect(ids).toContain(otherPriceVariant);
  });

  it("recupera por folio exacto el ticket presentado por el cliente", async () => {
    const variant = await createVariant("Ticket escaneable", 13000, 1);
    const sale = await createSale(variant, 1, 13000);
    const result = await state.admin!.rpc("get_sale_ticket_by_folio", {
      p_location_id: state.locationId,
      p_folio: sale.folio.toLowerCase(),
    });
    expect(result.error).toBeNull();
    expect(result.data.folio).toBe(sale.folio);
    expect(result.data.items).toHaveLength(1);
  });

  it("dos cambios concurrentes nunca devuelven dos veces el mismo renglón", async () => {
    const returnedVariant = await createVariant(
      "Concurrente entrada",
      15000,
      1,
    );
    const firstOutput = await createVariant("Concurrente salida A", 15000, 1);
    const secondOutput = await createVariant("Concurrente salida B", 15000, 1);
    const sale = await createSale(returnedVariant, 1, 15000);
    const firstAuthorization = await authorizeReturn();
    const secondAuthorization = await authorizeReturn();
    const exchange = (variantId: string, authorizationToken: string) =>
      state.admin!.rpc("create_return_exchange", {
        p_idempotency_key: crypto.randomUUID(),
        p_cash_session_id: state.sessionId,
        p_original_sale_id: sale.saleId,
        p_items_in: [
          {
            sale_item_id: sale.saleItemId,
            quantity: 1,
            condition: "RESELLABLE",
          },
        ],
        p_items_out: [{ variant_id: variantId, quantity: 1 }],
        p_charge_payments: [],
        p_refund_references: [],
        p_authorization_token: authorizationToken,
        p_reason: "Prueba concurrente",
      });
    const results = await Promise.all([
      exchange(firstOutput, firstAuthorization),
      exchange(secondOutput, secondAuthorization),
    ]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(
      results.filter((result) =>
        result.error?.message.includes("RETURN_EXCEEDS_SOLD"),
      ),
    ).toHaveLength(1);
  });

  it("si no hay existencia de salida revierte también la entrada", async () => {
    const returnedVariant = await createVariant("Atómico entrada", 17000, 1);
    const unavailableVariant = await createVariant("Atómico salida", 17000, 0);
    const sale = await createSale(returnedVariant, 1, 17000);
    const result = await state.admin!.rpc("create_return_exchange", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionId,
      p_original_sale_id: sale.saleId,
      p_items_in: [
        { sale_item_id: sale.saleItemId, quantity: 1, condition: "RESELLABLE" },
      ],
      p_items_out: [{ variant_id: unavailableVariant, quantity: 1 }],
      p_charge_payments: [],
      p_refund_references: [],
      p_authorization_token: await authorizeReturn(),
      p_reason: "Prueba sin existencia",
    });
    expect(result.error?.message).toContain("INSUFFICIENT_STOCK");
    expect(await stockOf(returnedVariant)).toBe(0);
    const returned = await state
      .server!.from("return_items")
      .select("id")
      .eq("sale_item_id", sale.saleItemId);
    expect(returned.data).toEqual([]);
  });

  it("impide usar el RPC anterior para saltarse el PIN de gerente", async () => {
    const returnedVariant = await createVariant("Precio entrada", 20000, 1);
    const deliveredVariant = await createVariant("Precio salida", 21000, 1);
    const sale = await createSale(returnedVariant, 1, 20000);
    const result = await state.admin!.rpc("create_equal_exchange", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionId,
      p_original_sale_id: sale.saleId,
      p_items_in: [{ sale_item_id: sale.saleItemId, quantity: 1 }],
      p_items_out: [{ variant_id: deliveredVariant, quantity: 1 }],
      p_reason: "Diferencia pendiente",
    });
    expect(result.error).not.toBeNull();
  });

  it("el libro de cambios no se puede editar ni con la clave de servidor", async () => {
    const update = await state
      .server!.from("returns")
      .update({ reason: "Alterado" })
      .eq("id", state.lastReturnId);
    const deletion = await state
      .server!.from("return_items")
      .delete()
      .eq("return_id", state.lastReturnId);
    expect(update.error?.message).toContain("RETURNS_LEDGER_IMMUTABLE");
    expect(deletion.error?.message).toContain("RETURNS_LEDGER_IMMUTABLE");
  });

  it("devuelve parcialmente por los mismos métodos originales y descuenta el efectivo", async () => {
    const variant = await createVariant("Devolución dividida", 20000, 2);
    const sale = await createSale(variant, 2, 40000, [
      { method_code: "CASH", amount_cents: 16000, tendered_cents: 16000 },
      { method_code: "CARD", amount_cents: 24000, reference: "VENTA-001" },
    ]);
    const created = await state.admin!.rpc("create_return_exchange", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionId,
      p_original_sale_id: sale.saleId,
      p_items_in: [
        { sale_item_id: sale.saleItemId, quantity: 1, condition: "RESELLABLE" },
      ],
      p_items_out: [],
      p_charge_payments: [],
      p_refund_references: [{ method_code: "CARD", reference: "DEV-001" }],
      p_authorization_token: await authorizeReturn(),
      p_reason: "El cliente solicitó devolución",
    });
    expect(created.error).toBeNull();
    expect(created.data.difference_cents).toBe(-20000);
    const payments = await state
      .server!.from("return_payments")
      .select("direction,method_code,amount_cents,reference")
      .eq("return_id", created.data.id)
      .order("method_code");
    expect(payments.data).toEqual([
      {
        direction: "REFUND",
        method_code: "CARD",
        amount_cents: 12000,
        reference: "DEV-001",
      },
      {
        direction: "REFUND",
        method_code: "CASH",
        amount_cents: 8000,
        reference: null,
      },
    ]);
    expect(await stockOf(variant)).toBe(1);
    const cash = await state
      .server!.from("cash_movements")
      .select("amount_cents")
      .eq("reference_type", "RETURN")
      .eq("reference_id", created.data.id)
      .single();
    expect(cash.data?.amount_cents).toBe(-8000);
  });

  it("rechaza una devolución sin capacidad vigente de gerente", async () => {
    const variant = await createVariant("Sin autorización", 9000, 1);
    const sale = await createSale(variant, 1, 9000);
    const created = await state.admin!.rpc("create_return_exchange", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionId,
      p_original_sale_id: sale.saleId,
      p_items_in: [
        { sale_item_id: sale.saleItemId, quantity: 1, condition: "RESELLABLE" },
      ],
      p_items_out: [],
      p_charge_payments: [],
      p_refund_references: [],
      p_authorization_token: crypto.randomUUID(),
      p_reason: "Sin autorización",
    });
    expect(created.error?.message).toContain("RETURN_AUTHORIZATION_REQUIRED");
    expect(await stockOf(variant)).toBe(0);
  });

  it("cobra exactamente la diferencia cuando el reemplazo cuesta más", async () => {
    const returned = await createVariant("Cambio entrada barato", 20000, 1);
    const delivered = await createVariant("Cambio salida caro", 25000, 1);
    const sale = await createSale(returned, 1, 20000);
    const created = await state.admin!.rpc("create_return_exchange", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionId,
      p_original_sale_id: sale.saleId,
      p_items_in: [
        {
          sale_item_id: sale.saleItemId,
          quantity: 1,
          condition: "RESELLABLE",
        },
      ],
      p_items_out: [{ variant_id: delivered, quantity: 1 }],
      p_charge_payments: [
        { method_code: "CARD", amount_cents: 5000, reference: "DIF-001" },
      ],
      p_refund_references: [],
      p_authorization_token: await authorizeReturn(),
      p_reason: "Cambio por producto de mayor precio",
    });
    expect(created.error).toBeNull();
    expect(created.data.difference_cents).toBe(5000);
    expect(await stockOf(returned)).toBe(1);
    expect(await stockOf(delivered)).toBe(0);
  });

  it("devuelve la diferencia por los métodos originales cuando el reemplazo cuesta menos", async () => {
    const returned = await createVariant("Cambio entrada caro", 20000, 1);
    const delivered = await createVariant("Cambio salida barato", 15000, 1);
    const sale = await createSale(returned, 1, 20000, [
      { method_code: "CASH", amount_cents: 8000, tendered_cents: 8000 },
      { method_code: "CARD", amount_cents: 12000, reference: "VENTA-002" },
    ]);
    const created = await state.admin!.rpc("create_return_exchange", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionId,
      p_original_sale_id: sale.saleId,
      p_items_in: [
        {
          sale_item_id: sale.saleItemId,
          quantity: 1,
          condition: "RESELLABLE",
        },
      ],
      p_items_out: [{ variant_id: delivered, quantity: 1 }],
      p_charge_payments: [],
      p_refund_references: [{ method_code: "CARD", reference: "DEV-DIF-002" }],
      p_authorization_token: await authorizeReturn(),
      p_reason: "Cambio por producto de menor precio",
    });
    expect(created.error).toBeNull();
    expect(created.data.difference_cents).toBe(-5000);
    const payments = await state
      .server!.from("return_payments")
      .select("method_code,amount_cents")
      .eq("return_id", created.data.id)
      .order("method_code");
    expect(payments.data).toEqual([
      { method_code: "CARD", amount_cents: 3000 },
      { method_code: "CASH", amount_cents: 2000 },
    ]);
  });

  it("un artículo dañado deja evidencia pero no vuelve a existencia", async () => {
    const variant = await createVariant("Producto dañado", 11000, 1);
    const sale = await createSale(variant, 1, 11000);
    const created = await state.admin!.rpc("create_return_exchange", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionId,
      p_original_sale_id: sale.saleId,
      p_items_in: [
        { sale_item_id: sale.saleItemId, quantity: 1, condition: "DAMAGED" },
      ],
      p_items_out: [],
      p_charge_payments: [],
      p_refund_references: [],
      p_authorization_token: await authorizeReturn(),
      p_reason: "Daño de fabricación",
    });
    expect(created.error).toBeNull();
    expect(await stockOf(variant)).toBe(0);
    const movements = await state
      .server!.from("inventory_movements")
      .select("movement_type,quantity")
      .eq("reference_id", created.data.id)
      .order("id");
    expect(movements.data).toEqual([
      { movement_type: "RETURN", quantity: 1 },
      { movement_type: "ADJUSTMENT", quantity: -1 },
    ]);
  });

  it("aplica el plazo configurable desde la base", async () => {
    const policy = await state.admin!.rpc("update_return_policy", {
      p_location_id: state.locationId,
      p_window_days: 0,
    });
    expect(policy.error).toBeNull();
    const variant = await createVariant("Plazo vencido", 7000, 1);
    const sale = await createSale(variant, 1, 7000);
    const created = await state.admin!.rpc("create_return_exchange", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: state.sessionId,
      p_original_sale_id: sale.saleId,
      p_items_in: [
        { sale_item_id: sale.saleItemId, quantity: 1, condition: "RESELLABLE" },
      ],
      p_items_out: [],
      p_charge_payments: [],
      p_refund_references: [],
      p_authorization_token: await authorizeReturn(),
      p_reason: "Fuera de plazo",
    });
    expect(created.error?.message).toContain("RETURN_WINDOW_EXPIRED");
    expect(
      (
        await state.admin!.rpc("update_return_policy", {
          p_location_id: state.locationId,
          p_window_days: 15,
        })
      ).error,
    ).toBeNull();
  });
});
