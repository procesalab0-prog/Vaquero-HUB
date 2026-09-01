import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-Anon-2026!";
const runCode = Date.now().toString().slice(-8);

type Fixture = { id: string; client: SupabaseClient };
const state = {
  admin: null as Fixture | null,
  cashier: null as Fixture | null,
  locationId: "",
  customerId: "",
  customerAuthId: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function serverClient() {
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.sequential("M1B: anonimización y límite por origen", () => {
  beforeAll(async () => {
    const server = serverClient();
    const { data: roles } = await server.from("roles").select("id, code");
    const roleId = Object.fromEntries(
      (roles ?? []).map((role) => [role.code, role.id]),
    );

    const { data: location } = await server
      .from("locations")
      .insert({ code: `AN${runCode}`, name: "Anonimiza", type: "STORE" })
      .select("id")
      .single();
    state.locationId = location!.id;

    for (const def of [
      { key: "admin", role: "ADMIN" },
      { key: "cashier", role: "CASHIER" },
    ] as const) {
      const email = `anon-${def.key}-${runCode}@vaquero.test`;
      const { data: authData } = await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      const id = authData.user!.id;
      await server.from("app_users").insert({
        id,
        employee_code: `AN${def.key.slice(0, 1).toUpperCase()}${runCode}`,
        full_name: `Prueba ${def.key}`,
        email,
        role_id: roleId[def.role],
      });
      await server
        .from("user_locations")
        .insert({ user_id: id, location_id: state.locationId });

      const client = publicClient();
      await client.auth.signInWithPassword({ email, password });
      state[def.key] = { id, client };
    }

    const { data: customer } = await state.admin!.client.rpc(
      "create_customer",
      {
        p_full_name: "Cliente Que Pide Borrado",
        p_phone: `353${runCode}`,
        p_email: `cliente-${runCode}@correo.test`,
        p_birthdate: "1990-05-10",
        p_location_id: state.locationId,
        p_privacy_notice_version: "v1",
        p_marketing_consent: true,
      },
    );
    state.customerId = (customer as { id: string }).id;

    // Se le liga una cuenta de acceso, para comprobar que también se limpia.
    const { data: customerAuth } = await serverClient().auth.admin.createUser({
      email: `cuenta-${runCode}@correo.test`,
      email_confirm: true,
    });
    state.customerAuthId = customerAuth.user!.id;
    await serverClient()
      .from("customers")
      .update({ auth_user_id: state.customerAuthId })
      .eq("id", state.customerId);
  });

  it("no deja anonimizar a quien no tiene el permiso", async () => {
    const { error } = await state.cashier!.client.rpc("anonymize_customer", {
      p_customer_id: state.customerId,
      p_reason: "prueba",
    });
    expect(error?.message).toContain("NOT_AUTHORIZED");
  });

  it("exige un motivo", async () => {
    const { error } = await state.admin!.client.rpc("anonymize_customer", {
      p_customer_id: state.customerId,
      p_reason: "   ",
    });
    expect(error?.message).toContain("REASON_REQUIRED");
  });

  it("borra los datos personales y devuelve la cuenta a eliminar", async () => {
    const { data, error } = await state.admin!.client.rpc(
      "anonymize_customer",
      { p_customer_id: state.customerId, p_reason: "solicitud del titular" },
    );
    expect(error).toBeNull();
    expect(data).toBe(state.customerAuthId);

    const { data: row } = await serverClient()
      .from("customers")
      .select(
        "full_name, phone_e164, email, birthdate, auth_user_id, is_anonymized, member_number",
      )
      .eq("id", state.customerId)
      .single();

    expect(row!.full_name).toBe("Cliente anonimizado");
    expect(row!.phone_e164).toBeNull();
    expect(row!.email).toBeNull();
    expect(row!.birthdate).toBeNull();
    expect(row!.auth_user_id).toBeNull();
    expect(row!.is_anonymized).toBe(true);
    // El número de socio se conserva: no es un dato personal y es lo que
    // mantiene unidas las ventas históricas.
    expect(row!.member_number).toBeTruthy();
  });

  it("no deja rastro de los datos viejos en la bitácora", async () => {
    const { data } = await serverClient()
      .from("audit_log")
      .select("action, before_data, after_data, metadata")
      .eq("entity_type", "customers")
      .eq("entity_id", state.customerId);

    for (const entry of data ?? []) {
      expect(entry.before_data).toBeNull();
      expect(entry.after_data).toBeNull();
    }

    const anonymized = (data ?? []).find(
      (entry) => entry.action === "customers.anonymized",
    );
    expect(anonymized).toBeTruthy();
    expect((anonymized!.metadata as Record<string, unknown>).reason).toBe(
      "solicitud del titular",
    );
  });

  it("no se puede anonimizar dos veces", async () => {
    const { error } = await state.admin!.client.rpc("anonymize_customer", {
      p_customer_id: state.customerId,
      p_reason: "otra vez",
    });
    expect(error?.message).toContain(
      "CUSTOMER_NOT_FOUND_OR_ALREADY_ANONYMIZED",
    );
  });

  it("limita las peticiones de acceso por origen", async () => {
    const server = serverClient();
    const source = "a".repeat(64);
    const results: boolean[] = [];

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { data } = await server.rpc("reserve_auth_request_by_source", {
        p_source_hash: source,
        p_max_attempts: 10,
        p_window_seconds: 300,
      });
      results.push(data as boolean);
    }

    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.slice(10)).toEqual([false, false]);

    // Un origen distinto no queda castigado por el anterior.
    const { data: otherSource } = await server.rpc(
      "reserve_auth_request_by_source",
      { p_source_hash: "b".repeat(64), p_max_attempts: 10 },
    );
    expect(otherSource).toBe(true);
  });

  it("rechaza un identificador de origen que no sea un hash", async () => {
    const { error } = await serverClient().rpc(
      "reserve_auth_request_by_source",
      { p_source_hash: "no-es-un-hash" },
    );
    expect(error?.message).toContain("INVALID_SOURCE_HASH");
  });

  it("no deja que un usuario normal use el limitador", async () => {
    const { error } = await state.admin!.client.rpc(
      "reserve_auth_request_by_source",
      { p_source_hash: "c".repeat(64) },
    );
    expect(error).not.toBeNull();
  });
});
