"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { normalizeMexicanPhone } from "@/lib/customers";

const customersPath = "/clientes";

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function databaseErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error ?? "UNKNOWN_ERROR");
}

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("CUSTOMER_ALREADY_EXISTS")) return "cliente-duplicado";
  if (message.includes("PRIVACY_NOTICE_REQUIRED"))
    return "cliente-aviso-requerido";
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

    if (
      !fullName ||
      !normalizeMexicanPhone(phone) ||
      !privacyNoticeVersion ||
      !locationId
    ) {
      status = !privacyNoticeVersion
        ? "cliente-aviso-requerido"
        : "cliente-datos-invalidos";
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

export async function setCustomerCredit(formData: FormData) {
  let status = "credito-error";
  try {
    const { supabase } = await requirePermission("customers.credit");
    const customerId = textField(formData, "customer_id");
    const isAuthorized = formData.get("is_authorized") === "on";
    const limitText = textField(formData, "limit").replace(/,/g, "");
    const limitCents = isAuthorized
      ? Math.round(Number(limitText || 0) * 100)
      : 0;
    const reason = textField(formData, "reason");

    if (
      !customerId ||
      !Number.isSafeInteger(limitCents) ||
      limitCents < 0 ||
      (isAuthorized && limitCents <= 0) ||
      reason.length < 3
    ) {
      status = "credito-datos-invalidos";
    } else {
      const { error } = await supabase.rpc("set_customer_credit", {
        p_customer_id: customerId,
        p_is_authorized: isAuthorized,
        p_limit_cents: limitCents,
        p_reason: reason,
      });
      if (error) throw error;
      status = isAuthorized ? "credito-autorizado" : "credito-desactivado";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    status = message.includes("CREDIT_BALANCE_REMAINS")
      ? "credito-saldo-pendiente"
      : message.includes("CREDIT_LIMIT_BELOW_BALANCE")
        ? "credito-limite-menor-saldo"
        : status;
    console.error("[clientes/setCustomerCredit] failed", {
      status,
      message: message || "UNKNOWN_ERROR",
    });
  }

  revalidatePath(customersPath);
  redirect(`${customersPath}?status=${status}`);
}

export async function receiveCustomerCreditPayment(formData: FormData) {
  let status = "abono-error";
  let customerIdForReceipt = "";
  let paymentId = "";
  try {
    const { supabase } = await requirePermission("credit.collect");
    const customerId = textField(formData, "customer_id");
    const cashCents = Math.round(
      Number(textField(formData, "cash") || 0) * 100,
    );
    const cardCents = Math.round(
      Number(textField(formData, "card") || 0) * 100,
    );
    const transferCents = Math.round(
      Number(textField(formData, "transfer") || 0) * 100,
    );
    const cardReference = textField(formData, "card_reference");
    const transferReference = textField(formData, "transfer_reference");
    const note = textField(formData, "note");
    const payments = [] as Array<{
      method_code: "CASH" | "CARD" | "TRANSFER";
      amount_cents: number;
      tendered_cents?: number;
      reference?: string;
    }>;
    if (cashCents > 0)
      payments.push({
        method_code: "CASH",
        amount_cents: cashCents,
        tendered_cents: cashCents,
      });
    if (cardCents > 0)
      payments.push({
        method_code: "CARD",
        amount_cents: cardCents,
        reference: cardReference,
      });
    if (transferCents > 0)
      payments.push({
        method_code: "TRANSFER",
        amount_cents: transferCents,
        reference: transferReference,
      });
    const invalid =
      !customerId ||
      payments.length === 0 ||
      payments.some(
        (payment) =>
          !Number.isSafeInteger(payment.amount_cents) ||
          payment.amount_cents <= 0 ||
          (payment.method_code !== "CASH" &&
            (payment.reference?.length ?? 0) < 3),
      );
    if (invalid) {
      status = "abono-datos-invalidos";
    } else {
      const { data: session, error: sessionError } = await supabase.rpc(
        "get_my_cash_session",
      );
      const cashSessionId = (session as { id?: string } | null)?.id;
      if (sessionError || !cashSessionId) {
        status = "abono-caja-requerida";
      } else {
        const { data, error } = await supabase.rpc(
          "record_customer_credit_payment",
          {
            p_idempotency_key: crypto.randomUUID(),
            p_cash_session_id: cashSessionId,
            p_customer_id: customerId,
            p_payments: payments,
            p_note: note || null,
          },
        );
        if (error) throw error;
        paymentId = String((data as { id?: string } | null)?.id ?? "");
        customerIdForReceipt = customerId;
        status = "abono-registrado";
      }
    }
  } catch (error) {
    const message = databaseErrorText(error);
    status = message.includes("CREDIT_OVERPAYMENT")
      ? "abono-mayor-saldo"
      : message.includes("CREDIT_BALANCE_EMPTY")
        ? "abono-sin-saldo"
        : status;
    console.error("[clientes/receiveCreditPayment] failed", {
      status,
      message: message || "UNKNOWN_ERROR",
    });
  }
  revalidatePath(customersPath);
  revalidatePath("/caja");
  const receiptQuery = customerIdForReceipt
    ? `&credit=${encodeURIComponent(customerIdForReceipt)}${paymentId ? `&payment=${encodeURIComponent(paymentId)}` : ""}`
    : "";
  redirect(`${customersPath}?status=${status}${receiptQuery}`);
}
