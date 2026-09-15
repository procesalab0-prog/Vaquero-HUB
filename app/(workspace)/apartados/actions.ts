"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";

const path = "/apartados";
const field = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
const amount = (data: FormData, name: string) =>
  Math.round(Number(field(data, name) || 0) * 100);

export async function receiveLayawayPayment(formData: FormData) {
  let status = "abono-error";
  let paymentId = "";
  try {
    const { supabase } = await requirePermission("layaways.manage");
    const layawayId = field(formData, "layaway_id");
    const cash = amount(formData, "cash");
    const card = amount(formData, "card");
    const transfer = amount(formData, "transfer");
    const payments: Array<Record<string, string | number>> = [];
    if (cash > 0)
      payments.push({
        method_code: "CASH",
        amount_cents: cash,
        tendered_cents: cash,
      });
    if (card > 0)
      payments.push({
        method_code: "CARD",
        amount_cents: card,
        reference: field(formData, "card_reference"),
      });
    if (transfer > 0)
      payments.push({
        method_code: "TRANSFER",
        amount_cents: transfer,
        reference: field(formData, "transfer_reference"),
      });
    if (
      !layawayId ||
      payments.length === 0 ||
      payments.some(
        (p) =>
          !Number.isSafeInteger(p.amount_cents) ||
          Number(p.amount_cents) <= 0 ||
          (p.method_code !== "CASH" && String(p.reference).length < 3),
      )
    ) {
      status = "abono-datos-invalidos";
    } else {
      const session = await supabase.rpc("get_my_cash_session");
      const sessionId = (session.data as { id?: string } | null)?.id;
      if (session.error || !sessionId) status = "abono-caja-requerida";
      else {
        const result = await supabase.rpc("record_layaway_payment", {
          p_idempotency_key: crypto.randomUUID(),
          p_cash_session_id: sessionId,
          p_layaway_id: layawayId,
          p_payments: payments,
          p_note: field(formData, "note") || null,
        });
        if (result.error) throw result.error;
        paymentId = String((result.data as { id?: string } | null)?.id ?? "");
        status = "abono-registrado";
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LAYAWAY_OVERPAYMENT")) status = "abono-mayor-saldo";
    if (message.includes("LAYAWAY_NOT_PAYABLE")) status = "abono-no-disponible";
    console.error("[apartados/receivePayment] failed", { status, message });
  }
  revalidatePath(path);
  revalidatePath("/caja");
  redirect(
    `${path}?status=${status}${paymentId ? `&payment=${encodeURIComponent(paymentId)}` : ""}`,
  );
}

export async function cancelOverdueLayaway(formData: FormData) {
  let status = "cancelacion-error";
  let penalty = "";
  let released = "";
  try {
    const { supabase } = await requirePermission("layaways.manage");
    const layawayId = field(formData, "layaway_id");
    const reason = field(formData, "reason");
    if (!layawayId || reason.length < 3 || reason.length > 500) {
      status = "cancelacion-datos-invalidos";
    } else {
      const result = await supabase.rpc("cancel_overdue_layaway", {
        p_idempotency_key: crypto.randomUUID(),
        p_layaway_id: layawayId,
        p_reason: reason,
      });
      if (result.error) throw result.error;
      const outcome = result.data as {
        penalty_cents?: number;
        released_balance_cents?: number;
      } | null;
      penalty = String(Number(outcome?.penalty_cents ?? 0));
      released = String(Number(outcome?.released_balance_cents ?? 0));
      status = "apartado-cancelado";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LAYAWAY_CANCELLATION_POLICY_UNDEFINED")) {
      status = "cancelacion-no-vencido";
    } else if (message.includes("LAYAWAY_NOT_CANCELLABLE")) {
      status = "cancelacion-no-disponible";
    }
    console.error("[apartados/cancelOverdue] failed", { status, message });
  }
  revalidatePath(path);
  revalidatePath("/inventario");
  revalidatePath("/pos");
  redirect(
    `${path}?status=${status}${
      status === "apartado-cancelado"
        ? `&penalty=${encodeURIComponent(penalty)}&released=${encodeURIComponent(released)}`
        : ""
    }`,
  );
}

export async function substituteLayawayItem(formData: FormData) {
  let status = "sustitucion-error";
  let total = "";
  let balance = "";
  try {
    const { supabase } = await requirePermission("layaways.modify");
    const layawayId = field(formData, "layaway_id");
    const itemId = field(formData, "layaway_item_id");
    const expectedVariantId = field(formData, "expected_variant_id");
    const newVariantId = field(formData, "new_variant_id");
    const reason = field(formData, "reason");
    if (
      !layawayId ||
      !itemId ||
      !expectedVariantId ||
      !newVariantId ||
      expectedVariantId === newVariantId ||
      reason.length < 3 ||
      reason.length > 500
    ) {
      status = "sustitucion-datos-invalidos";
    } else {
      const result = await supabase.rpc("substitute_layaway_item", {
        p_operation_key: crypto.randomUUID(),
        p_layaway_id: layawayId,
        p_layaway_item_id: itemId,
        p_expected_variant_id: expectedVariantId,
        p_new_variant_id: newVariantId,
        p_reason: reason,
      });
      if (result.error) throw result.error;
      const outcome = result.data as {
        new_total_cents?: number;
        new_balance_cents?: number;
      } | null;
      total = String(Number(outcome?.new_total_cents ?? 0));
      balance = String(Number(outcome?.new_balance_cents ?? 0));
      status = "sustitucion-registrada";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("INSUFFICIENT_STOCK")) {
      status = "sustitucion-sin-existencia";
    } else if (message.includes("LAYAWAY_SUBSTITUTION_REFUND_UNDEFINED")) {
      status = "sustitucion-reembolso-pendiente";
    } else if (message.includes("LAYAWAY_ITEM_CHANGED")) {
      status = "sustitucion-desactualizada";
    } else if (message.includes("LAYAWAY_DUPLICATE_VARIANT")) {
      status = "sustitucion-variante-repetida";
    } else if (message.includes("LAYAWAY_NOT_MODIFIABLE")) {
      status = "sustitucion-no-disponible";
    }
    console.error("[apartados/substituteItem] failed", { status, message });
  }
  revalidatePath(path);
  revalidatePath("/inventario");
  revalidatePath("/pos");
  redirect(
    `${path}?status=${status}${
      status === "sustitucion-registrada"
        ? `&total=${encodeURIComponent(total)}&balance=${encodeURIComponent(balance)}`
        : ""
    }`,
  );
}
