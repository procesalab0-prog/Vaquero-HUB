import { WorkspaceShell } from "@/components/workspace-shell";
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
  return (
    <WorkspaceShell
      key={activeLocation?.id ?? "sin-sucursal"}
      identity={identity}
      initialLocationId={activeLocation?.id ?? ""}
    >
      {children}
    </WorkspaceShell>
  );
}
