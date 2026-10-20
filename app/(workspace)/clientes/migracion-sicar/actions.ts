"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";
import {
  customerReviewEnabled,
  reviewAmountCents,
  reviewFailure,
} from "@/lib/customer-migration";
const path = "/clientes/migracion-sicar";
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export async function submitSourceReview(form: FormData) {
  let status = "guardado";
  const key = str(form, "key");
  try {
    if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL))
      throw Error("NOT_AUTHORIZED");
    const { supabase } = await requirePermission("customers.manage");
    const { error } = await supabase.rpc("m9_customer_review", {
      p_action: "SAVE_REVIEW",
      p_input: {
        key,
        disposition: str(form, "disposition"),
        target: str(form, "target"),
        note: str(form, "note"),
      },
    });
    if (error) throw error;
  } catch (error) {
    status = reviewFailure(
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "",
    );
  }
  revalidatePath(path);
  redirect(`${path}?key=${encodeURIComponent(key)}&status=${status}`);
}
export async function submitSourceTrial(form: FormData) {
  let status = "ensayo-listo";
  const run = str(form, "run");
  try {
    if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL))
      throw Error("NOT_AUTHORIZED");
    const { supabase } = await requirePermission("credit.collect");
    const action = str(form, "operation");
    if (!["QA_LINK", "QA_PAY"].includes(action)) throw Error("INVALID_ACTION");
    const amount =
      action === "QA_PAY" ? reviewAmountCents(str(form, "amount")) : 0;
    if (amount === null) throw Error("INVALID_AMOUNT");
    const { error } = await supabase.rpc("m9_customer_review", {
      p_action: action,
      p_input: { run, request: str(form, "request"), amount_cents: amount },
    });
    if (error) throw error;
  } catch (error) {
    status = reviewFailure(
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "",
    );
  }
  revalidatePath(path);
  redirect(`${path}?run=${encodeURIComponent(run)}&status=${status}`);
}
