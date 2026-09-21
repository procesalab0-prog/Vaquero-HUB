import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { isValidMemberNumber } from "../../lib/customers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Registro-Mi-Vaquero-2026!";
const runCode = Date.now().toString().slice(-7);

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.sequential("M1B: autorregistro seguro de clientes", () => {
  let server: SupabaseClient;
  let customerUserId = "";
  let customerClient: SupabaseClient;
  const customerEmail = `registro-${runCode}@vaquero.test`;
  const customerPhone = `351${runCode}`;

  beforeAll(async () => {
    server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await server.auth.admin.createUser({
      email: customerEmail,
      password,
      email_confirm: true,
      app_metadata: { account_type: "customer_pending" },
    });
    expect(error).toBeNull();
    customerUserId = data.user!.id;
    customerClient = publicClient();
    const signIn = await customerClient.auth.signInWithPassword({
      email: customerEmail,
      password,
    });
    expect(signIn.error).toBeNull();
  });

  it("no permite completar el perfil directamente desde el navegador", async () => {
    const result = await customerClient.rpc(
      "complete_customer_self_registration",
      {
        p_auth_user_id: customerUserId,
        p_full_name: "Cliente registro",
        p_phone: customerPhone,
        p_privacy_notice_version: "TEST-SELF-1",
      },
    );
    expect(result.error).not.toBeNull();
  });

  it("crea la tarjeta sólo desde servidor y conserva el consentimiento", async () => {
    const result = await server.rpc("complete_customer_self_registration", {
      p_auth_user_id: customerUserId,
      p_full_name: "Cliente registro",
      p_phone: customerPhone,
      p_birthdate: "1995-06-15",
      p_privacy_notice_version: "TEST-SELF-1",
      p_marketing_consent: true,
    });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(isValidMemberNumber(result.data[0].member_number)).toBe(true);

    const customer = await server
      .from("customers")
      .select(
        "auth_user_id, email, phone_e164, privacy_notice_version, marketing_consent",
      )
      .eq("auth_user_id", customerUserId)
      .single();
    expect(customer.error).toBeNull();
    expect(customer.data).toMatchObject({
      auth_user_id: customerUserId,
      email: customerEmail,
      phone_e164: `+52${customerPhone}`,
      privacy_notice_version: "TEST-SELF-1",
      marketing_consent: true,
    });
  });

  it("es idempotente cuando el servidor reintenta la misma alta", async () => {
    const first = await server.rpc("complete_customer_self_registration", {
      p_auth_user_id: customerUserId,
      p_full_name: "Cliente registro",
      p_phone: customerPhone,
      p_privacy_notice_version: "TEST-SELF-1",
    });
    const second = await server.rpc("complete_customer_self_registration", {
      p_auth_user_id: customerUserId,
      p_full_name: "Cliente registro",
      p_phone: customerPhone,
      p_privacy_notice_version: "TEST-SELF-1",
    });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data[0].customer_id).toBe(first.data[0].customer_id);
  });

  it("vincula por correo verificado sin duplicar un cliente de tienda", async () => {
    const email = `registro-vinculo-${runCode}@vaquero.test`;
    const phone = `354${runCode}`;
    const existing = await server
      .from("customers")
      .insert({
        full_name: "Cliente creado en tienda",
        phone_e164: `+52${phone}`,
        email,
        privacy_consent_at: new Date().toISOString(),
        privacy_notice_version: "TEST-OLD",
      })
      .select("id")
      .single();
    expect(existing.error).toBeNull();
    const auth = await server.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(auth.error).toBeNull();

    const result = await server.rpc("complete_customer_self_registration", {
      p_auth_user_id: auth.data.user!.id,
      p_full_name: "No reemplazar este nombre",
      p_phone: phone,
      p_privacy_notice_version: "TEST-SELF-1",
    });
    expect(result.error).toBeNull();
    expect(result.data[0].customer_id).toBe(existing.data!.id);

    const linked = await server
      .from("customers")
      .select("auth_user_id, full_name, privacy_notice_version")
      .eq("id", existing.data!.id)
      .single();
    expect(linked.data).toMatchObject({
      auth_user_id: auth.data.user!.id,
      full_name: "Cliente creado en tienda",
      privacy_notice_version: "TEST-SELF-1",
    });
  });

  it("rechaza convertir una identidad de empleado en cliente", async () => {
    const roles = await server
      .from("roles")
      .select("id")
      .eq("code", "ADMIN")
      .single();
    const employeeEmail = `registro-staff-${runCode}@vaquero.test`;
    const auth = await server.auth.admin.createUser({
      email: employeeEmail,
      password,
      email_confirm: true,
    });
    expect(auth.error).toBeNull();
    const employeeId = auth.data.user!.id;
    const profile = await server.from("app_users").insert({
      id: employeeId,
      employee_code: `RS${runCode}`,
      full_name: "Empleado registro",
      email: employeeEmail,
      role_id: roles.data!.id,
    });
    expect(profile.error).toBeNull();

    const result = await server.rpc("complete_customer_self_registration", {
      p_auth_user_id: employeeId,
      p_full_name: "Empleado registro",
      p_phone: `352${runCode}`,
      p_privacy_notice_version: "TEST-SELF-1",
    });
    expect(result.error?.message).toContain("STAFF_ACCOUNT_NOT_ALLOWED");
  });

  it("no permite apropiarse de un teléfono que ya pertenece a otro cliente", async () => {
    const occupiedPhone = `353${runCode}`;
    const existing = await server.from("customers").insert({
      full_name: "Cliente existente",
      phone_e164: `+52${occupiedPhone}`,
      privacy_consent_at: new Date().toISOString(),
      privacy_notice_version: "TEST-SELF-1",
    });
    expect(existing.error).toBeNull();

    const otherEmail = `registro-conflicto-${runCode}@vaquero.test`;
    const auth = await server.auth.admin.createUser({
      email: otherEmail,
      password,
      email_confirm: true,
    });
    expect(auth.error).toBeNull();
    const result = await server.rpc("complete_customer_self_registration", {
      p_auth_user_id: auth.data.user!.id,
      p_full_name: "Cliente conflicto",
      p_phone: occupiedPhone,
      p_privacy_notice_version: "TEST-SELF-1",
    });
    expect(result.error?.message).toContain("PHONE_ALREADY_REGISTERED");
  });
});
