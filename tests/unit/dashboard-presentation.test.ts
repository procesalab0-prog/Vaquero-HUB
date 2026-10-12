import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  permissions: [] as string[],
  permissionError: false,
  rpcs: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/auth/active-location", () => ({
  resolveActiveLocation: async () => ({ id: "branch", name: "Sucursal QA" }),
}));
vi.mock("@/lib/auth/workspace-session", () => ({
  getWorkspaceSession: async () => ({
    userId: "cashier",
    profile: { role_id: "role", is_active: true, user_locations: [] },
    supabase: {
      from: () => ({
        select: () => ({
          eq: async () => ({
            data: state.permissions.map((permission_code) => ({
              permission_code,
            })),
            error: state.permissionError ? {} : null,
          }),
        }),
      }),
      rpc: async (name: string) => {
        state.rpcs.push(name);
        return { data: [], error: null };
      },
    },
  }),
}));
vi.mock("@/app/(workspace)/inicio/migration-questions", () => ({
  MigrationQuestions: () => null,
}));
vi.mock("@/app/(workspace)/inicio/dashboard-greeting", () => ({
  DashboardGreeting: () => null,
}));
vi.mock("@/app/(workspace)/inicio/workspace-notes", () => ({
  WorkspaceNotes: () => null,
}));
vi.mock("@/app/(workspace)/inicio/note-actions", () => ({
  saveWorkspaceNote: () => {},
}));
import DashboardPage from "../../app/(workspace)/inicio/page";
function elements(tree: unknown): Array<{ href?: string; className?: string }> {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const props = (tree as { props: Record<string, unknown> }).props;
  return [props, ...elements(props.children)];
}
beforeEach(() => {
  state.permissions = [];
  state.permissionError = false;
  state.rpcs = [];
});
it("Inicio de cajero no ofrece altas ni métricas de gerencia y no consulta reportes", async () => {
  state.permissions = ["pos.sell", "cash.open"];
  const nodes = elements(
    await DashboardPage({ searchParams: Promise.resolve({}) }),
  );
  const links = nodes.map((n) => n.href).filter(Boolean);
  expect(links.some((h) => h?.startsWith("/pos"))).toBe(true);
  expect(links.some((h) => h?.startsWith("/productos"))).toBe(false);
  expect(links.some((h) => h?.startsWith("/inventario"))).toBe(false);
  expect(nodes.some((n) => n.className === "metric-card metric-sales")).toBe(
    false,
  );
  expect(state.rpcs).not.toContain("get_sales_report_v2");
  expect(state.rpcs).not.toContain("get_inventory_snapshot");
});
it("error de permisos retira accesos y no dispara consultas operativas", async () => {
  state.permissionError = true;
  const nodes = elements(
    await DashboardPage({ searchParams: Promise.resolve({}) }),
  );
  expect(nodes.some((n) => n.href?.startsWith("/pos"))).toBe(false);
  expect(state.rpcs).toEqual(["list_workspace_notes"]);
});
