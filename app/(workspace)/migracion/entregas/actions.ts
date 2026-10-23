"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import {
  assertCaptureOrigin,
  captureRequest,
  isCaptureReceipt,
  type DeliveryCaptureState,
} from "@/lib/m9-delivery-capture";
export async function saveDeliveryObservation(
  _previous: DeliveryCaptureState,
  form: FormData,
): Promise<DeliveryCaptureState> {
  try {
    if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL))
      throw Error("STAGING_REQUIRED");
    const h = await headers();
    assertCaptureOrigin(
      h.get("origin"),
      h.get("x-forwarded-host") ?? h.get("host"),
    );
    const { profile, supabase } = await requirePermission("customers.manage");
    const role = Array.isArray(profile.roles)
      ? profile.roles[0]
      : profile.roles;
    if (role?.code !== "ADMIN") throw Error("NOT_AUTHORIZED");
    const p = captureRequest(form);
    const { data, error } = await supabase.rpc("m9_delivery_capture_write", {
      p_input: p,
    });
    if (
      error ||
      !isCaptureReceipt(data) ||
      data.request_id !== p.request_id ||
      data.document_key !== p.document_key
    )
      return {
        status: "error",
        message:
          "No se guardó la declaración. Actualiza el documento y revisa que la evidencia y la última respuesta sigan vigentes.",
      };
    revalidatePath("/migracion/entregas");
    return {
      status: "saved",
      message:
        p.action === "REVOKE"
          ? "Declaración retirada mediante un nuevo evento. El historial se conserva."
          : "Declaración documental guardada. No cambia entregas, inventario, cobros ni saldos. Actualiza para ver la revisión vigente.",
    };
  } catch {
    return {
      status: "error",
      message:
        "No se pudo guardar. Revisa tu acceso, confirma la opción elegida y actualiza este documento antes de intentar otra vez.",
    };
  }
}
