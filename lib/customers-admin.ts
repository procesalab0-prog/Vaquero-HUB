import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Anonimiza los datos personales de un cliente a petición suya.
 *
 * Resuelve el choque entre dos reglas del proyecto: el cliente puede pedir
 * que borren sus datos, y el historial nunca se borra. Las ventas quedan
 * intactas apuntando al mismo registro, ya anónimo — una venta es un
 * registro contable, el nombre del comprador es un dato personal.
 *
 * El permiso lo valida la función de PostgreSQL contra el usuario de la
 * sesión, no este código: por eso la llamada va con el cliente de sesión y
 * no con el privilegiado.
 */
export async function anonymizeCustomer(customerId: string, reason: string) {
  const supabase = await createClient();
  const { data: authUserId, error } = await supabase.rpc("anonymize_customer", {
    p_customer_id: customerId,
    p_reason: reason,
  });
  if (error) throw error;

  // Segundo paso, y sin él la anonimización queda a medias: el registro
  // del cliente ya no tiene datos personales, pero su usuario de Auth
  // todavía guarda el correo o el teléfono con el que entraba.
  if (authUserId) {
    const admin = createAdminClient();
    const { error: deleteError } = await admin.auth.admin.deleteUser(
      authUserId as string,
    );
    if (deleteError) throw deleteError;
  }

  return { authAccountRemoved: Boolean(authUserId) };
}
