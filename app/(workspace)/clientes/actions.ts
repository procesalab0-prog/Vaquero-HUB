"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { normalizeMexicanPhone } from "@/lib/customers";

const customersPath = "/clientes";

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("CUSTOMER_ALREADY_EXISTS")) return "cliente-duplicado";
  if (message.includes("PRIVACY_NOTICE_REQUIRED")) return "cliente-aviso-requerido";
  if (message.includes("LOCATION_NOT_ALLOWED")) return "cliente-sucursal-error";
  return "cliente-error";
}

export async function createCustomer(formData: FormData) {
  let status = "cliente-error";
  try {
    const { supabase } = await requirePermission("customers.manage");
    const fullName = textField(formData, "full_name");
    const phone = textField(formData, "phone");
    const email = textField(formData, "email").toLowerCase();
    const birthdate = textField(formData, "birthdate");
    const locationId = textField(formData, "location_id");
    const privacyNoticeVersion = textField(formData, "privacy_notice_version");
    const marketingConsent = formData.get("marketing_consent") === "on";

    if (!fullName || !normalizeMexicanPhone(phone) || !privacyNoticeVersion || !locationId) {
      status = !privacyNoticeVersion ? "cliente-aviso-requerido" : "cliente-datos-invalidos";
    } else {
      const { error } = await supabase.rpc("create_customer", {
        p_full_name: fullName,
        p_phone: phone,
        p_email: email || null,
        p_birthdate: birthdate || null,
        p_location_id: locationId,
        p_privacy_notice_version: privacyNoticeVersion,
        p_marketing_consent: marketingConsent,
      });
      if (error) throw error;
      status = "cliente-creado";
    }
  } catch (error) {
    status = errorStatus(error);
    console.error("[clientes/createCustomer] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }

  revalidatePath(customersPath);
  redirect(`${customersPath}?status=${status}`);
}

export async function updateCustomer(formData: FormData) {
  let status = "cliente-error";
  try {
    const { supabase } = await requirePermission("customers.manage");
    const customerId = textField(formData, "customer_id");
    const fullName = textField(formData, "full_name");
    const phone = textField(formData, "phone");
    const email = textField(formData, "email").toLowerCase();
    const birthdate = textField(formData, "birthdate");
    const marketingConsent = formData.get("marketing_consent") === "on";

    if (!customerId || !fullName || !normalizeMexicanPhone(phone)) {
      status = "cliente-datos-invalidos";
    } else {
      const { error } = await supabase.rpc("update_customer", {
        p_customer_id: customerId,
        p_full_name: fullName,
        p_phone: phone,
        p_email: email || null,
        p_birthdate: birthdate || null,
        p_marketing_consent: marketingConsent,
      });
      if (error) throw error;
      status = "cliente-actualizado";
    }
  } catch (error) {
    status = errorStatus(error);
    console.error("[clientes/updateCustomer] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }

  revalidatePath(customersPath);
  redirect(`${customersPath}?status=${status}`);
}
