import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function requiredPublicEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Falta la variable ${name} en el servidor.`);
  }

  return value;
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requiredPublicEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    requiredPublicEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Los Server Components no pueden escribir cookies. El proxy de M1
            // se encargará de refrescar sesiones antes de proteger rutas.
          }
        },
      },
    },
  );
}
