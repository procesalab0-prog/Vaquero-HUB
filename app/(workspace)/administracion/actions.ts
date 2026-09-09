"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/supabase/config";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/location-preference";

const adminPath = "/administracion";

class EmployeeCreationError extends Error {
  constructor(
    readonly status: string,
    cause?: unknown,
  ) {
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
    if (!isSupabaseAdminConfigured())
      throw new EmployeeCreationError("empleado-configuracion-error");

    const fullName = textField(formData, "full_name");
    const employeeCode = textField(formData, "employee_code").toUpperCase();
    const email = textField(formData, "email").toLowerCase();
    const password = textField(formData, "password");
    const roleId = textField(formData, "role_id");
    const locationId = textField(formData, "location_id");
    if (
      !fullName ||
      !employeeCode ||
      !email ||
      password.length < 12 ||
      !roleId ||
      !locationId
    ) {
      throw new EmployeeCreationError("empleado-datos-invalidos");
    }

    const [{ data: role }, { data: location }] = await Promise.all([
      supabase.from("roles").select("id").eq("id", roleId).single(),
      supabase
        .from("locations")
        .select("id")
        .eq("id", locationId)
        .eq("is_active", true)
        .single(),
    ]);
    if (!role || !location)
      throw new EmployeeCreationError("empleado-relacion-invalida");

    const admin = createAdminClient();
    const { data: authData, error: authError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { account_type: "employee" },
      });
    if (authError || !authData.user) {
      const errorCode =
        authError && "code" in authError ? authError.code : null;
      throw new EmployeeCreationError(
        errorCode === "email_exists"
          ? "empleado-correo-existe"
          : "empleado-acceso-error",
        authError,
      );
    }

    const { error: profileError } = await admin.from("app_users").insert({
      id: authData.user.id,
      employee_code: employeeCode,
      full_name: fullName,
      email,
      role_id: roleId,
    });
    if (profileError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(
        authData.user.id,
      );
      if (cleanupError)
        console.error("[administracion/createEmployee] auth cleanup failed", {
          userId: authData.user.id,
          code: cleanupError.code,
        });
      throw new EmployeeCreationError("empleado-perfil-error", profileError);
    }

    const { error: locationError } = await admin.from("user_locations").insert({
      user_id: authData.user.id,
      location_id: locationId,
    });
    if (locationError) {
      await admin
        .from("app_users")
        .update({ is_active: false })
        .eq("id", authData.user.id);
      throw new EmployeeCreationError("empleado-sucursal-error", locationError);
    }
    status = "empleado-creado";
  } catch (error) {
    status =
      error instanceof EmployeeCreationError ? error.status : "empleado-error";
    console.error("[administracion/createEmployee] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
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
    const supervisorPin = textField(formData, "supervisor_pin");
    const isActive = formData.get("is_active") === "on";
    if (!id || (supervisorPin && !/^\d{4,8}$/.test(supervisorPin))) {
      status = "empleado-pin-invalido";
      throw new Error("INVALID_PIN");
    }

    // La cuenta propia no puede cambiarse de rol ni desactivarse desde esta
    // pantalla. Su PIN sí puede actualizarse con el RPC seguro de perfil.
    if (id === userId) {
      if (!supervisorPin) {
        status = "empleado-pin-vacio";
        throw new Error("PIN_REQUIRED");
      }
      const { error: ownPinError } = await supabase.rpc("update_my_profile", {
        p_full_name: null,
        p_new_pin: supervisorPin,
      });
      if (ownPinError) throw ownPinError;
      status = "empleado-pin-actualizado";
    } else {
      if (!fullName || !roleId) throw new Error("INVALID_INPUT");
      const locationIds = formData
        .getAll("location_ids")
        .map((value) => String(value).trim())
        .filter(Boolean);
      if (!locationIds.length) {
        status = "empleado-sucursales-vacias";
        throw new Error("LOCATION_REQUIRED");
      }

      const { error } = await supabase
        .from("app_users")
        .update({ full_name: fullName, role_id: roleId, is_active: isActive })
        .eq("id", id);
      if (error) throw error;
      const { error: locationError } = await supabase.rpc(
        "set_employee_locations",
        {
          p_user_id: id,
          p_location_ids: locationIds,
        },
      );
      if (locationError) {
        status = "empleado-sucursales-error";
        throw locationError;
      }
      if (supervisorPin) {
        const { error: pinError } = await supabase.rpc(
          "reset_employee_supervisor_pin",
          {
            p_user_id: id,
            p_new_pin: supervisorPin,
          },
        );
        if (pinError) throw pinError;
      }
      status = "empleado-actualizado";
    }
  } catch (error) {
    if (
      !status.startsWith("empleado-pin-") &&
      !status.startsWith("empleado-sucursales-")
    )
      status = "empleado-error";
    console.error("[administracion/updateEmployee] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
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
    if (!code || !name || !["STORE", "WAREHOUSE"].includes(type))
      throw new Error("INVALID_INPUT");

    // La función deja la sucursal usable de una sola vez: la crea, le da acceso
    // a quien la dio de alta y le abre su primera caja. Insertar la fila a mano
    // dejaba una sucursal que se veía en la lista y no servía para nada.
    const result = await supabase.rpc("upsert_location", {
      p_id: id || null,
      p_code: code,
      p_name: name,
      p_type: type,
      p_address: address,
      p_phone: phone,
      p_is_active: formData.get("is_active") === "on",
    });
    if (result.error) throw result.error;
    if (!id && typeof result.data === "object" && result.data) {
      const locationId = String((result.data as { id?: unknown }).id ?? "");
      if (locationId) {
        const cookieStore = await cookies();
        cookieStore.set(ACTIVE_LOCATION_COOKIE, locationId, {
          httpOnly: false,
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 365,
          path: "/",
          secure: process.env.NODE_ENV === "production",
        });
      }
    }
    status = id ? "sucursal-actualizada" : "sucursal-creada";
  } catch {
    status = "sucursal-error";
  }
  revalidatePath(adminPath);
  redirect(`${adminPath}?tab=sucursales&status=${status}`);
}
