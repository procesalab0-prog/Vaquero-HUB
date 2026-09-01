import { createBrowserClient } from "@supabase/ssr";

function requiredPublicEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Falta la variable pública ${name}.`);
  }

  return value;
}

export function createClient() {
  return createBrowserClient(
    requiredPublicEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    requiredPublicEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  );
}
