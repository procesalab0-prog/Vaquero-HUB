import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M7-Credito-2026!";
const runCode = Date.now().toString().slice(-8);

const state = {
  server: null as SupabaseClient | null,
  admin: null as SupabaseClient | null,
  cashier: null as SupabaseClient | null,
  warehouse: null as SupabaseClient | null,
  customerId: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.sequential("M7.1: autorización y cartera de crédito", () => {
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
      .insert({ code: `CR${runCode}`, name: "Crédito prueba", type: "STORE" })
      .select("id")
      .single();
    expect(location.error).toBeNull();

    for (const definition of [
      { key: "admin", role: "ADMIN" },
      { key: "cashier", role: "CASHIER" },
      { key: "warehouse", role: "WAREHOUSE" },
    ] as const) {
      const email = `m7-credit-${definition.key}-${runCode}@vaquero.test`;
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
            employee_code: `CR${definition.key.toUpperCase()}${runCode}`,
            full_name: `Crédito ${definition.key}`,
            email,
            role_id: roleIds[definition.role],
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await server.from("user_locations").insert({
            user_id: userId,
            location_id: location.data!.id,
          })
        ).error,
      ).toBeNull();
      const client = publicClient();
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      state[definition.key] = client;
    }

    const customer = await state.cashier!.rpc("create_customer", {
      p_full_name: `Cliente crédito ${runCode}`,
      p_phone: `353${runCode.padStart(8, "0").slice(-7)}`,
      p_location_id: location.data!.id,
      p_privacy_notice_version: "TEST-M7",
    });
    expect(customer.error).toBeNull();
    state.customerId = customer.data.id;
  }, 30_000);

  it("sólo administración o gerencia autoriza y cambia el límite", async () => {
    const denied = await state.cashier!.rpc("set_customer_credit", {
      p_customer_id: state.customerId,
      p_is_authorized: true,
      p_limit_cents: 500000,
      p_reason: "Intento de caja",
    });
    expect(denied.error?.message).toContain("NOT_AUTHORIZED");

    const allowed = await state.admin!.rpc("set_customer_credit", {
      p_customer_id: state.customerId,
      p_is_authorized: true,
      p_limit_cents: 500000,
      p_reason: "Autorizado por gerencia",
    });
    expect(allowed.error).toBeNull();
    expect(allowed.data).toEqual(
      expect.objectContaining({
        customer_id: state.customerId,
        is_authorized: true,
        limit_cents: 500000,
        balance_cents: 0,
        available_cents: 500000,
      }),
    );
  });

  it("el POS puede consultar disponibilidad sin poder editarla", async () => {
    const summary = await state.cashier!.rpc("get_customer_credit_summary", {
      p_customer_id: state.customerId,
    });
    expect(summary.error).toBeNull();
    expect(summary.data.available_cents).toBe(500000);

    const warehouse = await state.warehouse!.rpc(
      "get_customer_credit_summary",
      { p_customer_id: state.customerId },
    );
    expect(warehouse.error?.message).toContain("NOT_AUTHORIZED");
  });

  it("mantiene tablas y libro fuera del acceso directo", async () => {
    const directAccount = await state
      .admin!.from("customer_credit_accounts")
      .select("customer_id");
    const directLedger = await state
      .admin!.from("customer_credit_ledger")
      .select("id");
    const forgedLedger = await state
      .server!.from("customer_credit_ledger")
      .insert({
        customer_id: state.customerId,
        entry_type: "CHARGE",
        amount_cents: 100,
        due_date: "2026-10-10",
        location_id: crypto.randomUUID(),
        actor_user_id: crypto.randomUUID(),
        reference_type: "FORGED",
        reference_id: crypto.randomUUID(),
      });
    expect(directAccount.error).not.toBeNull();
    expect(directLedger.error).not.toBeNull();
    expect(forgedLedger.error?.message).toContain(
      "DIRECT_CREDIT_LEDGER_WRITE_FORBIDDEN",
    );
  });

  it("lista la cartera mediante la función autorizada y audita el cambio", async () => {
    const list = await state.admin!.rpc("list_customer_credit_accounts", {
      p_query: runCode,
      p_limit: 20,
    });
    expect(list.error).toBeNull();
    expect(list.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customer_id: state.customerId,
          is_authorized: true,
          limit_cents: 500000,
        }),
      ]),
    );
    const audits = await state
      .server!.from("audit_log")
      .select("action,metadata")
      .eq("entity_type", "customer_credit_accounts")
      .eq("entity_id", state.customerId);
    expect(audits.error).toBeNull();
    expect(audits.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "customer_credit.settings_changed",
        }),
      ]),
    );
  });
});
