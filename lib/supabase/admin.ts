import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function requiredServerEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Falta la variable secreta ${name} en el servidor.`);
  }

  return value;
}

/**
 * Cliente privilegiado para tareas administrativas explícitas del servidor.
 * No debe usarse para evitar RLS ni importarse desde componentes de cliente.
 */
export function createAdminClient() {
  return createSupabaseClient(
    requiredServerEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    requiredServerEnv("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
