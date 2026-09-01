"use client";

import { useFormStatus } from "react-dom";

export function LoginButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button login-submit" type="submit" disabled={pending}>
      {pending ? "Verificando…" : "Entrar a Vaquero HUB"}
    </button>
  );
}
