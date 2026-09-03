"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";

type ActionResult = { ok: true; data?: Record<string, unknown> } | { ok: false; message: string };
const cents = (value: number) => Number.isFinite(value) ? Math.round(value * 100) : -1;

function failure(error: unknown): ActionResult {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("ALREADY_OPEN")) return { ok: false, message: "Esa caja o ese cajero ya tiene un turno abierto." };
  if (message.includes("INSUFFICIENT_CASH")) return { ok: false, message: "El retiro supera el efectivo esperado en caja." };
  if (message.includes("DIFFERENCE_REASON_REQUIRED")) return { ok: false, message: "Explica la diferencia antes de cerrar la caja." };
  return { ok: false, message: "No fue posible guardar la operación de caja." };
}

export async function openCashSession(registerId: string, openingAmount: number): Promise<ActionResult> {
  try {
    const { supabase } = await requirePermission("cash.open");
    const { error } = await supabase.rpc("open_cash_session", { p_register_id: registerId, p_opening_amount_cents: cents(openingAmount) });
    if (error) throw error;
    revalidatePath("/caja"); revalidatePath("/pos");
    return { ok: true };
  } catch (error) { return failure(error); }
}

export async function createCashRegister(locationId: string, code: string, name: string): Promise<ActionResult> {
  try {
    const { supabase } = await requirePermission("locations.manage");
    const { error } = await supabase.rpc("create_cash_register", {
      p_location_id: locationId,
      p_code: code.trim().toUpperCase(),
      p_name: name.trim(),
    });
    if (error) throw error;
    revalidatePath("/caja");
    return { ok: true };
  } catch (error) { return failure(error); }
}

export async function addCashMovement(input: { sessionId: string; type: "DEPOSIT" | "WITHDRAWAL"; amount: number; reason: string }): Promise<ActionResult> {
  try {
    const { supabase } = await requirePermission("cash.movement");
    const { error } = await supabase.rpc("record_cash_movement", { p_session_id: input.sessionId, p_type: input.type, p_amount_cents: cents(input.amount), p_reason: input.reason.trim() });
    if (error) throw error;
    revalidatePath("/caja"); return { ok: true };
  } catch (error) { return failure(error); }
}

export async function previewCashClose(sessionId: string, countedAmount: number): Promise<ActionResult> {
  try {
    const { supabase } = await requirePermission("cash.close");
    const { data, error } = await supabase.rpc("preview_cash_close", { p_session_id: sessionId, p_counted_amount_cents: cents(countedAmount) });
    if (error) throw error;
    return { ok: true, data: data as Record<string, unknown> };
  } catch (error) { return failure(error); }
}

export async function closeCashSession(input: { sessionId: string; countedAmount: number; reason?: string }): Promise<ActionResult> {
  try {
    const { supabase } = await requirePermission("cash.close");
    const { data, error } = await supabase.rpc("close_cash_session", { p_session_id: input.sessionId, p_counted_amount_cents: cents(input.countedAmount), p_difference_reason: input.reason?.trim() || null });
    if (error) throw error;
    revalidatePath("/caja"); revalidatePath("/pos");
    return { ok: true, data: data as Record<string, unknown> };
  } catch (error) { return failure(error); }
}
