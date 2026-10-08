import { NavigationProgress } from "@/components/navigation-progress";
import { WorkspaceBoot } from "@/components/workspace-boot";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Suspense } from "react";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { getWorkspaceIdentity } from "@/lib/auth/workspace-identity";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getWorkspaceIdentity();
  const activeLocation = identity
    ? await resolveActiveLocation(identity.locations)
    : null;
  // Sin pantalla de espera por sección: al cambiar de página se queda visible
  // la actual hasta que la nueva está lista, con la línea de NavigationProgress.
  return (
    <>
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <Suspense fallback={<WorkspaceBoot />}>
        <WorkspaceShell
          key={activeLocation?.id ?? "sin-sucursal"}
          identity={identity}
          initialLocationId={activeLocation?.id ?? ""}
        >
          {children}
        </WorkspaceShell>
      </Suspense>
    </>
  );
}
