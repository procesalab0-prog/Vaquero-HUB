"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createCustomerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("CUSTOMER_AUTH_NOT_CONFIGURED");

  return createSupabaseClient(url, key, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storageKey: "vaquero-hub-customer-auth-v1",
    },
  });
}
