import { WorkspaceShell } from "@/components/workspace-shell";
import { getWorkspaceIdentity } from "@/lib/auth/workspace-identity";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const identity = await getWorkspaceIdentity();
  return <WorkspaceShell identity={identity}>{children}</WorkspaceShell>;
}
