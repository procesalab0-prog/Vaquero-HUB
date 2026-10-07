"use server";
import { requirePermission } from "@/lib/auth/authorization";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function saveOwnerAnswer(form: FormData) {
  let result = "guardado";
  const question = String(form.get("question_id") ?? "");
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL)
      throw Error("STAGING_ONLY");
    const { supabase } = await requirePermission("products.update");
    const { error } = await supabase.rpc("m9_save_owner_answer", {
      p_cut: String(form.get("cut_sha") ?? ""),
      p_question: question,
      p_revision: Number(form.get("revision")),
      p_request: String(form.get("request_id") ?? ""),
      p_choice: String(form.get("choice") ?? ""),
      p_note: String(form.get("note") ?? ""),
      p_name: String(form.get("commercial_name") ?? ""),
    });
    if (error) throw Error(error.message);
    revalidatePath("/productos/migracion-dudas");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    result = /M9_ANSWER_CHANGED|M9_QUESTION_STALE/.test(message)
      ? "cambio"
      : /INVALID_OWNER_ANSWER/.test(message)
        ? "incompleto"
        : "error";
  }
  redirect(
    `/productos/migracion-dudas?${new URLSearchParams({ resultado: result, alcance: "todos", estado: "all", q: /^[a-f0-9]{64}$/.test(question) ? question : "" })}`,
  );
}
