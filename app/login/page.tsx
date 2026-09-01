import type { Metadata } from "next";
import Image from "next/image";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { login } from "./actions";
import { LoginButton } from "./login-button";

export const metadata: Metadata = { title: "Iniciar sesión" };

const messages: Record<string, string> = {
  campos: "Escribe tu correo y contraseña.",
  credenciales: "El correo o la contraseña no coinciden.",
  "sin-acceso": "Este usuario no está activo como empleado.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = isSupabaseConfigured();

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="login-brand">
          <Image src="/icons/icon-192.png" alt="Vaquero HUB" width={104} height={104} priority />
          <p className="eyebrow">Vaquero SM</p>
          <h1>Bienvenido a Vaquero HUB</h1>
          <p>Tu punto de venta, inventario y operación en un solo lugar.</p>
        </div>
        {configured ? (
          <form action={login} className="login-form">
            <label>
              <span>Correo del empleado</span>
              <input name="email" type="email" inputMode="email" autoComplete="username" required />
            </label>
            <label>
              <span>Contraseña</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error ? <p className="form-error" role="alert">{messages[error] ?? "No fue posible iniciar sesión."}</p> : null}
            <LoginButton />
          </form>
        ) : (
          <div className="login-preview-note">
            <strong>Vista de diseño activa</strong>
            <p>La autenticación real aparecerá en la vista previa conectada a staging. La web pública conserva por ahora la demostración actual.</p>
            <a className="primary-button" href="/inicio">Continuar a la demostración</a>
          </div>
        )}
        <small className="login-security">Acceso protegido por rol y sucursal · Creado por ProcesaLab</small>
      </section>
    </main>
  );
}
