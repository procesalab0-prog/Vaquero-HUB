"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/supabase/config";

const adminPath = "/administracion";

class EmployeeCreationError extends Error {
  constructor(readonly status: string, cause?: unknown) {
    super(status, { cause });
  }
}

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function createEmployee(formData: FormData) {
  let status = "empleado-error";
  try {
    const { supabase } = await requirePermission("users.manage");
    if (!isSupabaseAdminConfigured()) throw new EmployeeCreationError("empleado-configuracion-error");

    const fullName = textField(formData, "full_name");
    const employeeCode = textField(formData, "employee_code").toUpperCase();
    const email = textField(formData, "email").toLowerCase();
    const password = textField(formData, "password");
    const roleId = textField(formData, "role_id");
    const locationId = textField(formData, "location_id");
    if (!fullName || !employeeCode || !email || password.length < 12 || !roleId || !locationId) {
      throw new EmployeeCreationError("empleado-datos-invalidos");
    }

    const [{ data: role }, { data: location }] = await Promise.all([
      supabase.from("roles").select("id").eq("id", roleId).single(),
      supabase.from("locations").select("id").eq("id", locationId).eq("is_active", true).single(),
    ]);
    if (!role || !location) throw new EmployeeCreationError("empleado-relacion-invalida");

    const admin = createAdminClient();
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { account_type: "employee" },
    });
    if (authError || !authData.user) {
      const errorCode = authError && "code" in authError ? authError.code : null;
      throw new EmployeeCreationError(errorCode === "email_exists" ? "empleado-correo-existe" : "empleado-acceso-error", authError);
    }

    const { error: profileError } = await admin.from("app_users").insert({
      id: authData.user.id,
      employee_code: employeeCode,
      full_name: fullName,
      email,
      role_id: roleId,
    });
    if (profileError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(authData.user.id);
      if (cleanupError) console.error("[administracion/createEmployee] auth cleanup failed", { userId: authData.user.id, code: cleanupError.code });
      throw new EmployeeCreationError("empleado-perfil-error", profileError);
    }

    const { error: locationError } = await admin.from("user_locations").insert({
      user_id: authData.user.id,
      location_id: locationId,
    });
    if (locationError) {
      await admin.from("app_users").update({ is_active: false }).eq("id", authData.user.id);
      throw new EmployeeCreationError("empleado-sucursal-error", locationError);
    }
    status = "empleado-creado";
  } catch (error) {
    status = error instanceof EmployeeCreationError ? error.status : "empleado-error";
    console.error("[administracion/createEmployee] failed", { status, message: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
  }
  revalidatePath(adminPath);
  redirect(`${adminPath}?tab=empleados&status=${status}`);
}

export async function updateEmployee(formData: FormData) {
  let status = "empleado-error";
  try {
    const { supabase, userId } = await requirePermission("users.manage");
    const id = textField(formData, "id");
    const fullName = textField(formData, "full_name");
    const roleId = textField(formData, "role_id");
    const isActive = formData.get("is_active") === "on";
    if (!id || id === userId || !fullName || !roleId) throw new Error("INVALID_INPUT");

    const { error } = await supabase
      .from("app_users")
      .update({ full_name: fullName, role_id: roleId, is_active: isActive })
      .eq("id", id);
    if (error) throw error;
    status = "empleado-actualizado";
  } catch {
    status = "empleado-error";
  }
  revalidatePath(adminPath);
  redirect(`${adminPath}?tab=empleados&status=${status}`);
}

export async function saveLocation(formData: FormData) {
  let status = "sucursal-error";
  try {
    const { supabase } = await requirePermission("locations.manage");
    const id = textField(formData, "id");
    const code = textField(formData, "code").toUpperCase();
    const name = textField(formData, "name");
    const type = textField(formData, "type");
    const address = textField(formData, "address") || null;
    const phone = textField(formData, "phone") || null;
    if (!code || !name || !["STORE", "WAREHOUSE"].includes(type)) throw new Error("INVALID_INPUT");

    const payload = { code, name, type, address, phone, is_active: formData.get("is_active") === "on" };
    const result = id
      ? await supabase.from("locations").update(payload).eq("id", id).neq("type", "TRANSIT")
      : await supabase.from("locations").insert(payload);
    if (result.error) throw result.error;
    status = id ? "sucursal-actualizada" : "sucursal-creada";
  } catch {
    status = "sucursal-error";
  }
  revalidatePath(adminPath);
  redirect(`${adminPath}?tab=sucursales&status=${status}`);
}
