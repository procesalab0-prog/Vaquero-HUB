import type { Metadata } from "next";
import { cookies } from "next/headers";
import Image from "next/image";

import { MOTION_DAY_COOKIE, loginScene, storeDay } from "@/lib/entrance";
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
  const scene = loginScene({
    hasError: Boolean(error),
    lastFullDay: (await cookies()).get(MOTION_DAY_COOKIE)?.value,
    today: storeDay(),
  });

  return (
    <main className="login-screen" data-motion={scene}>
      <aside className="login-editorial-panel" aria-hidden="true">
        <span className="login-editorial-logo brand-mark">
          <Image
            src="/brand/logo-vaquerosm-blanco.png"
            alt=""
            width={520}
            height={226}
            priority
          />
        </span>
        <div>
          <p>OPERACIÓN · PUNTO DE VENTA</p>
          <strong>
            <span className="motion-line">
              <span>La tienda completa,</span>
            </span>
            <span className="motion-line">
              <span>en un solo lugar.</span>
            </span>
          </strong>
          <span>Diseñado alrededor de la operación real de Vaqueros SM.</span>
        </div>
      </aside>
      <section className="login-card">
        <div className="login-brand">
          <Image
            className="login-form-logo"
            src="/brand/logo-vaquerosm-negro.png"
            alt="Vaquero SM"
            width={240}
            height={105}
            priority
          />
          <p className="eyebrow">Mi Tienda SM</p>
          <h1>Bienvenido a Mi Tienda SM</h1>
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
