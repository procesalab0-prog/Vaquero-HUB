import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { PrintTest } from "./print-test";

export const metadata: Metadata = { title: "Prueba de impresión" };

export default async function PrintTestPage() {
  // La pantalla no escribe nada; sólo se exige una sesión válida del mostrador.
  if (isSupabaseConfigured()) await requirePermission("products.read");
  return <PrintTest />;
}
