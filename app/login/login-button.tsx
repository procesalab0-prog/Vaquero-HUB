"use client";

import { useFormStatus } from "react-dom";

export function LoginButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button login-submit" type="submit" disabled={pending}>
      {pending ? "Verificando…" : "Entrar a Mi Tienda SM"}
      {/* Sólo mientras el servidor responde: es progreso, no decoración. */}
      {pending ? <span className="login-submit-progress" aria-hidden="true" /> : null}
    </button>
  );
}
