"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  MOTION_DAY_COOKIE,
  MOTION_DAY_COOKIE_MAX_AGE,
  storeDay,
} from "@/lib/entrance";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) redirect("/login?error=campos");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) redirect("/login?error=credenciales");

  const { data: profile } = await supabase
    .from("app_users")
    .select("id, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile?.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=sin-acceso");
  }

  // A partir de este acceso confirmado, la pantalla de acceso usa su versión
  // corta el resto del día en este dispositivo.
  (await cookies()).set(MOTION_DAY_COOKIE, storeDay(), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: MOTION_DAY_COOKIE_MAX_AGE,
  });

  redirect("/inicio");
}
