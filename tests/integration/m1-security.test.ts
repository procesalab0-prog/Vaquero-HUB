import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const password = "Pruebas-M1-2026!";
const runCode = Date.now().toString().slice(-8);

type FixtureUser = {
  client: SupabaseClient;
  employeeCode: string;
  id: string;
};

const state = {
  admin: null as FixtureUser | null,
  cashier: null as FixtureUser | null,
  inactive: null as FixtureUser | null,
  lockSupervisor: null as FixtureUser | null,
  manager: null as FixtureUser | null,
  pendingAuthUserId: "",
  roles: {} as Record<string, string>,
  secondLocationId: "",
  supervisor: null as FixtureUser | null,
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signIn(email: string) {
  const client = publicClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return client;
}

describe.sequential("M1: matriz de identidad, permisos y RLS", () => {
  beforeAll(async () => {
    expect(url).toBeTruthy();
    expect(publishableKey).toBeTruthy();
    expect(secretKey).toBeTruthy();

    const adminApi = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: roles, error: rolesError } = await adminApi
      .from("roles")
      .select("id, code");
    expect(rolesError).toBeNull();
    state.roles = Object.fromEntries(
      (roles ?? []).map((role) => [role.code, role.id]),
    );

    const { data: locations, error: locationsError } = await adminApi
      .from("locations")
      .insert([
        { code: `S${runCode}A`, name: "Sucursal de prueba A", type: "STORE" },
        { code: `S${runCode}B`, name: "Sucursal de prueba B", type: "STORE" },
      ])
      .select("id, code");
    expect(locationsError).toBeNull();
    const firstLocationId = locations?.[0]?.id;
    state.secondLocationId = locations?.[1]?.id ?? "";
    expect(firstLocationId).toBeTruthy();
    expect(state.secondLocationId).toBeTruthy();

    const definitions = [
      { key: "admin", role: "ADMIN", active: true },
      { key: "manager", role: "MANAGER", active: true },
      { key: "cashier", role: "CASHIER", active: true },
      { key: "supervisor", role: "MANAGER", active: true },
      { key: "lockSupervisor", role: "MANAGER", active: true },
      { key: "inactive", role: "CASHIER", active: true },
      { key: "pending", role: "CASHIER", active: true },
    ] as const;

    for (const [index, definition] of definitions.entries()) {
      const email = `m1-${definition.key}-${runCode}@vaquero.test`;
      const employeeCode = `M1${runCode}${index}`;
      const { data, error } = await adminApi.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(error).toBeNull();
      expect(data.user).toBeTruthy();

      if (definition.key === "pending") {
        state.pendingAuthUserId = data.user!.id;
        continue;
      }

      const { error: profileError } = await adminApi.from("app_users").insert({
        id: data.user!.id,
        employee_code: employeeCode,
        full_name: `Usuario ${definition.key}`,
        email,
        role_id: state.roles[definition.role],
        is_active: definition.active,
      });
      expect(profileError).toBeNull();

      const fixture = {
        client: await signIn(email),
        employeeCode,
        id: data.user!.id,
      };
      state[definition.key] = fixture;
    }

    const { error: assignmentError } = await adminApi
      .from("user_locations")
      .insert([
        { user_id: state.cashier!.id, location_id: firstLocationId },
        { user_id: state.supervisor!.id, location_id: firstLocationId },
      ]);
    expect(assignmentError).toBeNull();

    for (const [fixture, pin] of [
      [state.supervisor!, "2468"],
      [state.lockSupervisor!, "9999"],
      [state.cashier!, "1357"],
    ] as const) {
      const { error } = await fixture.client.rpc("update_my_profile", {
        p_new_pin: pin,
      });
      expect(error).toBeNull();
    }
  }, 30_000);

  it("1. CASHIER no puede leer una sucursal no asignada", async () => {
    const { data, error } = await state
      .cashier!.client.from("locations")
      .select("id")
      .eq("id", state.secondLocationId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("2-3. CASHIER no puede cambiar su rol ni desactivarse", async () => {
    const roleAttempt = await state
      .cashier!.client.from("app_users")
      .update({ role_id: state.roles.MANAGER })
      .eq("id", state.cashier!.id)
      .select("id");
    const activeAttempt = await state
      .cashier!.client.from("app_users")
      .update({ is_active: false })
      .eq("id", state.cashier!.id)
      .select("id");

    expect(roleAttempt.data).toEqual([]);
    expect(activeAttempt.data).toEqual([]);
  });

  it("4. un usuario desactivado pierde acceso aun con sesión vigente", async () => {
    const { error: deactivateError } = await state
      .admin!.client.from("app_users")
      .update({ is_active: false })
      .eq("id", state.inactive!.id);
    expect(deactivateError).toBeNull();

    const { data } = await state.inactive!.client.from("roles").select("id");
    expect(data).toEqual([]);
  });

  it("13. MANAGER no puede crear empleados", async () => {
    const { error } = await state.manager!.client.from("app_users").insert({
      id: state.pendingAuthUserId,
      employee_code: `P${runCode}`,
      full_name: "Alta no autorizada",
      role_id: state.roles.CASHIER,
    });

    expect(error).not.toBeNull();
  });

  it("5. ADMIN cambia el rol de otro usuario y queda auditado", async () => {
    const { error } = await state
      .admin!.client.from("app_users")
      .update({ role_id: state.roles.CASHIER })
      .eq("id", state.manager!.id);
    expect(error).toBeNull();

    const { data: audit, error: auditError } = await state
      .admin!.client.from("audit_log")
      .select("id, actor_user_id, action, entity_id")
      .eq("actor_user_id", state.admin!.id)
      .eq("action", "app_users.update")
      .eq("entity_id", state.manager!.id);
    expect(auditError).toBeNull();
    expect(audit).toHaveLength(1);
  });

  it("6-7. ni ADMIN puede actualizar o borrar la bitácora", async () => {
    const { data: rows } = await state
      .admin!.client.from("audit_log")
      .select("id")
      .limit(1);
    const auditId = rows?.[0]?.id;
    expect(auditId).toBeTruthy();

    const updateResult = await state
      .admin!.client.from("audit_log")
      .update({ action: "forged" })
      .eq("id", auditId);
    const deleteResult = await state
      .admin!.client.from("audit_log")
      .delete()
      .eq("id", auditId);

    expect(updateResult.error).not.toBeNull();
    expect(deleteResult.error).not.toBeNull();
  });

  it("la clave de servidor sólo puede anexar a la bitácora", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: rows } = await server.from("audit_log").select("id").limit(1);
    const auditId = rows?.[0]?.id;
    expect(auditId).toBeTruthy();

    const updateResult = await server
      .from("audit_log")
      .update({ action: "server-forged" })
      .eq("id", auditId);
    const deleteResult = await server
      .from("audit_log")
      .delete()
      .eq("id", auditId);

    expect(updateResult.error).not.toBeNull();
    expect(deleteResult.error).not.toBeNull();
  });

  it("8. anon no tiene acceso a ninguna tabla de M1", async () => {
    const anon = publicClient();
    for (const table of [
      "locations",
      "roles",
      "permissions",
      "role_permissions",
      "app_users",
      "user_locations",
      "audit_log",
    ]) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      expect(error !== null || data?.length === 0).toBe(true);
    }
  });

  it("9. un PIN correcto con permiso devuelve al supervisor", async () => {
    const { data, error } = await state.cashier!.client.rpc(
      "verify_supervisor_pin",
      {
        p_employee_code: state.supervisor!.employeeCode,
        p_permission: "sales.discount",
        p_pin: "2468",
      },
    );

    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: "AUTHORIZED",
      supervisor_user_id: state.supervisor!.id,
    });
  });

  it("10. un PIN correcto sin permiso queda denegado", async () => {
    const { data, error } = await state.cashier!.client.rpc(
      "verify_supervisor_pin",
      {
        p_employee_code: state.cashier!.employeeCode,
        p_permission: "sales.discount",
        p_pin: "1357",
      },
    );

    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "INSUFFICIENT_PERMISSION" });
  });

  it("11. cinco PIN incorrectos bloquean la cuenta", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await state.cashier!.client.rpc(
        "verify_supervisor_pin",
        {
          p_employee_code: state.lockSupervisor!.employeeCode,
          p_permission: "sales.discount",
          p_pin: "0000",
        },
      );
      expect(error).toBeNull();
      expect(data).toMatchObject({ status: "INVALID_CREDENTIALS" });
    }

    const { data } = await state.cashier!.client.rpc("verify_supervisor_pin", {
      p_employee_code: state.lockSupervisor!.employeeCode,
      p_permission: "sales.discount",
      p_pin: "9999",
    });
    expect(data).toMatchObject({ status: "PIN_LOCKED" });
  }, 10_000);

  it("12. empleado inexistente y PIN incorrecto tienen tiempos similares", async () => {
    const measure = async (employeeCode: string) => {
      const started = performance.now();
      await state.cashier!.client.rpc("verify_supervisor_pin", {
        p_employee_code: employeeCode,
        p_permission: "sales.discount",
        p_pin: "0000",
      });
      return performance.now() - started;
    };

    const nonexistentMs = await measure(`NO${runCode}`);
    const incorrectMs = await measure(state.supervisor!.employeeCode);
    expect(Math.abs(nonexistentMs - incorrectMs)).toBeLessThan(300);
  });

  it("14. update_my_profile no admite role_id por su firma", async () => {
    const { error } = await state.cashier!.client.rpc(
      "update_my_profile" as never,
      {
        p_full_name: "Intento de elevación",
        p_role_id: state.roles.ADMIN,
      } as never,
    );
    expect(error).not.toBeNull();

    const { data } = await state
      .cashier!.client.from("app_users")
      .select("role_id")
      .eq("id", state.cashier!.id)
      .single();
    expect(data?.role_id).toBe(state.roles.CASHIER);
  });

  it("el registro público permanece deshabilitado", async () => {
    const { error } = await publicClient().auth.signUp({
      email: `registro-${runCode}@vaquero.test`,
      password,
    });
    expect(error).not.toBeNull();
  });
});
