import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { isValidMemberNumber } from "../../lib/customers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M1B-2026!";
const runCode = Date.now().toString().slice(-8);

type Fixture = { id: string; client: SupabaseClient };
const state = {
  admin: null as Fixture | null,
  cashier: null as Fixture | null,
  warehouse: null as Fixture | null,
  customer: null as Fixture | null,
  locationId: "",
  customerId: "",
  memberNumber: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.sequential("M1B: clientes, identidad y RLS", () => {
  beforeAll(async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: roles } = await server.from("roles").select("id, code");
    const roleIds = Object.fromEntries(
      (roles ?? []).map((role) => [role.code, role.id]),
    );
    const { data: location, error: locationError } = await server
      .from("locations")
      .insert({ code: `C${runCode}`, name: "Clientes prueba", type: "STORE" })
      .select("id")
      .single();
    expect(locationError).toBeNull();
    state.locationId = location!.id;

    for (const definition of [
      { key: "admin", role: "ADMIN" },
      { key: "cashier", role: "CASHIER" },
      { key: "warehouse", role: "WAREHOUSE" },
    ] as const) {
      const email = `m1b-${definition.key}-${runCode}@vaquero.test`;
      const { data: authData, error: authError } =
        await server.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
      expect(authError).toBeNull();
      const id = authData.user!.id;
      const { error: profileError } = await server.from("app_users").insert({
        id,
        employee_code: `M1B${definition.key.toUpperCase()}${runCode}`,
        full_name: `M1B ${definition.key}`,
        email,
        role_id: roleIds[definition.role],
      });
      expect(profileError).toBeNull();
      const { error: assignmentError } = await server
        .from("user_locations")
        .insert({ user_id: id, location_id: state.locationId });
      expect(assignmentError).toBeNull();
      const client = publicClient();
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      expect(signInError).toBeNull();
      state[definition.key] = { id, client };
    }
  }, 30_000);

  it("normaliza el teléfono y genera un número de socio válido", async () => {
    const { data, error } = await state.cashier!.client.rpc("create_customer", {
      p_full_name: "Cliente de Prueba",
      p_phone: "353 123 4567",
      p_email: `cliente-${runCode}@vaquero.test`,
      p_location_id: state.locationId,
      p_privacy_notice_version: "TEST-1",
      p_marketing_consent: false,
    });
    expect(error).toBeNull();
    expect(data.phone_e164).toBe("+523531234567");
    expect(isValidMemberNumber(data.member_number)).toBe(true);
    state.customerId = data.id;
    state.memberNumber = data.member_number;
  });

  it("detecta el mismo teléfono aunque llegue en otro formato", async () => {
    const { error } = await state.cashier!.client.rpc("create_customer", {
      p_full_name: "Duplicado",
      p_phone: "+52 353 123 4567",
      p_location_id: state.locationId,
      p_privacy_notice_version: "TEST-1",
    });
    expect(error?.message).toContain("CUSTOMER_ALREADY_EXISTS");
  });

  it("permite búsqueda única por teléfono, socio y nombre", async () => {
    for (const query of ["4567", state.memberNumber, "Cliente de Prueba"]) {
      const { data, error } = await state.cashier!.client.rpc(
        "search_customers",
        { p_query: query, p_limit: 10 },
      );
      expect(error).toBeNull();
      expect(data?.map((customer: { id: string }) => customer.id)).toContain(
        state.customerId,
      );
    }
  });

  it("expone al cliente autenticado sólo su tarjeta mediante RPC", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `cliente-${runCode}@vaquero.test`;
    const { data: authData, error: authError } =
      await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { account_type: "customer" },
      });
    expect(authError).toBeNull();
    const customerUserId = authData.user!.id;
    const { error: linkError } = await server
      .from("customers")
      .update({ auth_user_id: customerUserId })
      .eq("id", state.customerId);
    expect(linkError).toBeNull();

    const customerClient = publicClient();
    const { error: signInError } = await customerClient.auth.signInWithPassword(
      { email, password },
    );
    expect(signInError).toBeNull();
    state.customer = { id: customerUserId, client: customerClient };

    const card = await customerClient.rpc("get_my_customer_card");
    expect(card.error).toBeNull();
    expect(card.data).toEqual([
      {
        customer_id: state.customerId,
        member_number: state.memberNumber,
        full_name: "Cliente de Prueba",
      },
    ]);

    const directCustomers = await customerClient
      .from("customers")
      .select("id, phone_e164");
    const internalUsers = await customerClient.from("app_users").select("id");
    const internalSearch = await customerClient.rpc("search_customers", {
      p_query: "Cliente",
      p_limit: 10,
    });
    expect(directCustomers.data).toEqual([]);
    expect(internalUsers.data).toEqual([]);
    expect(internalSearch.error).not.toBeNull();
  });

  it("limita solicitudes de acceso y reserva esa operación sólo al servidor", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const first = await server.rpc("reserve_customer_auth_request", {
      p_customer_id: state.customerId,
      p_min_interval_seconds: 60,
    });
    const second = await server.rpc("reserve_customer_auth_request", {
      p_customer_id: state.customerId,
      p_min_interval_seconds: 60,
    });
    const cashierAttempt = await state.cashier!.client.rpc(
      "reserve_customer_auth_request",
      { p_customer_id: state.customerId, p_min_interval_seconds: 60 },
    );
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);
    expect(second.data).toBe(false);
    expect(cashierAttempt.error).not.toBeNull();
  });

  it("almacén y anon no pueden consultar ni crear clientes", async () => {
    const warehouseSearch = await state.warehouse!.client.rpc(
      "search_customers",
      { p_query: "Cliente", p_limit: 10 },
    );
    const warehouseRows = await state
      .warehouse!.client.from("customers")
      .select("id");
    const anonRows = await publicClient().from("customers").select("id");
    expect(warehouseSearch.error).not.toBeNull();
    expect(warehouseRows.data).toEqual([]);
    expect(anonRows.error !== null || anonRows.data?.length === 0).toBe(true);
  });

  it("ni ADMIN puede borrar clientes y la auditoría no duplica sus datos personales", async () => {
    const deleteAttempt = await state
      .admin!.client.from("customers")
      .delete()
      .eq("id", state.customerId);
    expect(deleteAttempt.error).not.toBeNull();

    const { data: audits, error } = await state
      .admin!.client.from("audit_log")
      .select("before_data, after_data, metadata")
      .eq("entity_type", "customers")
      .eq("entity_id", state.customerId);
    expect(error).toBeNull();
    expect(audits?.length).toBeGreaterThan(0);
    for (const audit of audits ?? []) {
      expect(audit.before_data).toBeNull();
      expect(audit.after_data).toBeNull();
      expect(JSON.stringify(audit.metadata)).not.toContain("3531234567");
    }
  });
});
