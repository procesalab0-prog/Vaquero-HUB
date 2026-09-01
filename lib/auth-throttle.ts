import "server-only";

import { createHmac } from "node:crypto";

/**
 * Identificador de origen para limitar peticiones de acceso.
 *
 * **Nunca se manda la dirección IP a la base de datos**: se manda un HMAC
 * de ella, así que del lado de PostgreSQL nunca entra un dato personal.
 * La llave es la clave secreta del servidor, que ya existe, nunca sale de
 * aquí y hace que el hash no se pueda revertir con una tabla precalculada.
 *
 * Devuelve `null` cuando no se puede identificar el origen; en ese caso el
 * llamador sigue adelante apoyado en el límite por cliente, que siempre
 * aplica.
 */
export function requestSourceHash(request: Request): string | null {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return null;

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  if (!ip) return null;

  return createHmac("sha256", secret).update(ip).digest("hex");
}
