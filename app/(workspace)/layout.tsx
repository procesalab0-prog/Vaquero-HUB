import { WorkspaceShell } from "@/components/workspace-shell";
import { Suspense } from "react";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { getWorkspaceIdentity } from "@/lib/auth/workspace-identity";
import { WEB_STAGING_URL } from "@/lib/web-draft";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getWorkspaceIdentity();
  const activeLocation = identity
    ? await resolveActiveLocation(identity.locations)
    : null;
  return (
    <Suspense fallback={<main aria-busy="true">Cargando sucursal…</main>}>
      <WorkspaceShell
        key={activeLocation?.id ?? "sin-sucursal"}
        identity={identity}
        initialLocationId={activeLocation?.id ?? ""}
      >
        {process.env.NEXT_PUBLIC_SUPABASE_URL === WEB_STAGING_URL && (
          <p
            role="status"
            style={{
              background: "#fff0c7",
              color: "#493414",
              padding: "12px 16px",
              margin: 0,
            }}
          >
            ENTORNO DE PRUEBAS · Los movimientos de este sistema no deben
            registrarse como ventas reales. SICAR continúa siendo el sistema de
            operación.
          </p>
        )}
        {children}
      </WorkspaceShell>
    </Suspense>
  );
}
