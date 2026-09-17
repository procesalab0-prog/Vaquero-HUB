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
  let paymentTotal = "";
  let paymentBalance = "";
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
        const outcome = result.data as {
          id?: string;
          total_cents?: number;
          balance_cents?: number;
        } | null;
        paymentId = String(outcome?.id ?? "");
        paymentTotal = String(Number(outcome?.total_cents ?? 0));
        paymentBalance = String(Number(outcome?.balance_cents ?? 0));
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
    `${path}?status=${status}${
      paymentId
        ? `&payment=${encodeURIComponent(paymentId)}&abono=${encodeURIComponent(paymentTotal)}&saldo=${encodeURIComponent(paymentBalance)}`
        : ""
    }`,
  );
}

export async function fulfillLayaway(formData: FormData) {
  let status = "entrega-error";
  let saleId = "";
  try {
    const { supabase } = await requirePermission("layaways.deliver");
    const layawayId = field(formData, "layaway_id");
    const confirmed = field(formData, "confirmed") === "yes";
    if (!layawayId || !confirmed) {
      status = "entrega-confirmacion-requerida";
    } else {
      const session = await supabase.rpc("get_my_cash_session");
      const sessionId = (session.data as { id?: string } | null)?.id;
      if (session.error || !sessionId) {
        status = "entrega-caja-requerida";
      } else {
        const result = await supabase.rpc("fulfill_layaway", {
          p_operation_key: crypto.randomUUID(),
          p_cash_session_id: sessionId,
          p_layaway_id: layawayId,
        });
        if (result.error) throw result.error;
        const outcome = result.data as {
          sale_id?: string;
        } | null;
        saleId = String(outcome?.sale_id ?? "");
        status = "entrega-registrada";
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LAYAWAY_NOT_READY")) {
      status = "entrega-no-liquidada";
    } else if (message.includes("LAYAWAY_WRONG_LOCATION")) {
      status = "entrega-sucursal-incorrecta";
    } else if (message.includes("LAYAWAY_ALREADY_FULFILLED")) {
      status = "entrega-ya-registrada";
    } else if (message.includes("RESERVATION_BALANCE_MISMATCH")) {
      status = "entrega-inventario-inconsistente";
    } else if (message.includes("LAYAWAY_TRANSFER_ACTIVE")) {
      status = "entrega-traspaso-activo";
    }
    console.error("[apartados/fulfill] failed", { status, message });
  }
  revalidatePath(path);
  revalidatePath("/inventario");
  revalidatePath("/pos");
  revalidatePath("/tickets");
  if (status === "entrega-registrada" && saleId) {
    redirect(`/tickets?venta=${encodeURIComponent(saleId)}&origen=apartado`);
  }
  redirect(`${path}?status=${status}`);
}

export async function requestLayawayDeliveryTransfer(formData: FormData) {
  let status = "traspaso-entrega-error";
  let transferFolio = "";
  try {
    const { supabase } = await requirePermission("transfers.create");
    const layawayId = field(formData, "layaway_id");
    const destinationId = field(formData, "to_location_id");
    const note = field(formData, "note");
    if (!layawayId || !destinationId || note.length > 500) {
      status = "traspaso-entrega-datos-invalidos";
    } else {
      const result = await supabase.rpc("request_layaway_delivery_transfer", {
        p_layaway_id: layawayId,
        p_to_location_id: destinationId,
        p_note: note || null,
      });
      if (result.error) throw result.error;
      transferFolio = String(
        Number((result.data as { folio?: number } | null)?.folio ?? 0),
      );
      status = "traspaso-entrega-solicitado";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LAYAWAY_NOT_READY")) {
      status = "traspaso-entrega-no-liquidado";
    } else if (message.includes("LAYAWAY_TRANSFER_ALREADY_EXISTS")) {
      status = "traspaso-entrega-duplicado";
    } else if (message.includes("LAYAWAY_ALREADY_AT_LOCATION")) {
      status = "traspaso-entrega-misma-sucursal";
    } else if (message.includes("LOCATION_NOT_FOUND")) {
      status = "traspaso-entrega-destino-invalido";
    }
    console.error("[apartados/requestDeliveryTransfer] failed", {
      status,
      message,
    });
  }
  revalidatePath(path);
  revalidatePath("/inventario");
  redirect(
    `${path}?status=${status}${
      transferFolio ? `&transfer=${encodeURIComponent(transferFolio)}` : ""
    }`,
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
    } else if (message.includes("LAYAWAY_TRANSFER_ACTIVE")) {
      status = "cancelacion-traspaso-activo";
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

export async function cancelActiveLayaway(formData: FormData) {
  let status = "cancelacion-excepcion-error";
  let refund = "";
  let penalty = "";
  let released = "";
  try {
    const { supabase } = await requirePermission("layaways.manage");
    const layawayId = field(formData, "layaway_id");
    const refundCents = amount(formData, "refund");
    const reason = field(formData, "reason");
    const supervisorCode = field(formData, "supervisor_code");
    const supervisorPin = field(formData, "supervisor_pin");
    const confirmed = field(formData, "confirmed") === "yes";
    const refundReferences: Array<Record<string, string>> = [];
    const cardReference = field(formData, "card_reference");
    const transferReference = field(formData, "transfer_reference");
    if (cardReference) {
      refundReferences.push({
        method_code: "CARD",
        reference: cardReference,
      });
    }
    if (transferReference) {
      refundReferences.push({
        method_code: "TRANSFER",
        reference: transferReference,
      });
    }
    if (
      !layawayId ||
      !confirmed ||
      !supervisorCode ||
      !/^\d{4,8}$/.test(supervisorPin) ||
      !Number.isSafeInteger(refundCents) ||
      refundCents < 0 ||
      reason.length < 3 ||
      reason.length > 500
    ) {
      status = "cancelacion-excepcion-datos-invalidos";
    } else {
      const session = await supabase.rpc("get_my_cash_session");
      const sessionId = (session.data as { id?: string } | null)?.id;
      if (session.error || !sessionId) {
        status = "cancelacion-excepcion-caja-requerida";
      } else {
        const authorization = await supabase.rpc("verify_supervisor_pin", {
          p_employee_code: supervisorCode,
          p_pin: supervisorPin,
          p_permission: "layaways.cancel_exception",
        });
        if (authorization.error) throw authorization.error;
        const authorized = authorization.data as {
          status?: string;
          authorization_token?: string;
        } | null;
        if (authorized?.status !== "AUTHORIZED") {
          status =
            authorized?.status === "PIN_LOCKED"
              ? "cancelacion-excepcion-pin-bloqueado"
              : authorized?.status === "INSUFFICIENT_PERMISSION"
                ? "cancelacion-excepcion-supervisor-sin-permiso"
                : "cancelacion-excepcion-pin-invalido";
        } else {
          const result = await supabase.rpc(
            "cancel_active_layaway_authorized",
            {
              p_operation_key: crypto.randomUUID(),
              p_cash_session_id: sessionId,
              p_layaway_id: layawayId,
              p_refund_cents: refundCents,
              p_refund_references: refundReferences,
              p_authorization_token: authorized.authorization_token,
              p_reason: reason,
            },
          );
          if (result.error) throw result.error;
          const outcome = result.data as {
            refund_cents?: number;
            penalty_cents?: number;
            released_balance_cents?: number;
          } | null;
          refund = String(Number(outcome?.refund_cents ?? 0));
          penalty = String(Number(outcome?.penalty_cents ?? 0));
          released = String(Number(outcome?.released_balance_cents ?? 0));
          status = "apartado-cancelado-excepcion";
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("INSUFFICIENT_CASH")) {
      status = "cancelacion-excepcion-efectivo-insuficiente";
    } else if (message.includes("REFUND_REFERENCE_REQUIRED")) {
      status = "cancelacion-excepcion-referencia-requerida";
    } else if (message.includes("REFUND_EXCEEDS_LAYAWAY_PAYMENTS")) {
      status = "cancelacion-excepcion-monto-invalido";
    } else if (message.includes("LAYAWAY_ALREADY_OVERDUE")) {
      status = "cancelacion-excepcion-ya-vencido";
    } else if (message.includes("LAYAWAY_NOT_CANCELLABLE")) {
      status = "cancelacion-excepcion-no-disponible";
    } else if (message.includes("LAYAWAY_TRANSFER_ACTIVE")) {
      status = "cancelacion-excepcion-traspaso-activo";
    } else if (message.includes("LAYAWAY_AUTHORIZATION_REQUIRED")) {
      status = "cancelacion-excepcion-autorizacion-vencida";
    }
    console.error("[apartados/cancelActive] failed", { status, message });
  }
  revalidatePath(path);
  revalidatePath("/inventario");
  revalidatePath("/pos");
  revalidatePath("/caja");
  redirect(
    `${path}?status=${status}${
      status === "apartado-cancelado-excepcion"
        ? `&refund=${encodeURIComponent(refund)}&penalty=${encodeURIComponent(penalty)}&released=${encodeURIComponent(released)}`
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
    } else if (message.includes("LAYAWAY_TRANSFER_ACTIVE")) {
      status = "sustitucion-traspaso-activo";
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
