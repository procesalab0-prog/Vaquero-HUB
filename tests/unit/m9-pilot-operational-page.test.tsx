import { Children, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  rpc: vi.fn(),
  enabled: true,
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.permission,
}));
vi.mock("@/lib/customer-migration", () => ({
  customerReviewEnabled: () => mocks.enabled,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("NOT_FOUND");
  },
}));
import PilotControl from "../../app/(workspace)/migracion/avance/pilot-control";
import Page from "../../app/(workspace)/migracion/avance/page";
import { controlFixture, controlNow } from "./fixtures/m9-pilot-operational";
function fixture() {
  const d = controlFixture();
  return {
    ...d,
    overview: {
      ...d.overview,
      catalog: {
        loaded_codes: 15961,
        review_rows_on_file: 15000,
        review_window: { window_current: false, expires_at: null },
        photo_evidence_rows: 5984,
        photo_storage_rows: 5871,
      },
      customers: {
        ...d.overview.customers,
        census_older_than_24h: true,
        accounts_reviewed: 60,
        historical_payments: 95,
      },
      woo: {
        remote_connected_trials: 5,
        native_rehearsals: 1,
        finance_enabled: false,
        stock_pilot_enabled: false,
        worker_enabled: false,
        capture_enabled: false,
      },
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(controlNow);
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.permission.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  const f = fixture();
  mocks.rpc.mockImplementation(async (name) => ({
    data: (
      {
        m9_parallel_readonly_overview: f.overview,
        m9_legacy_registry_read: f.registry,
        m9_delivery_capture_read: f.delivery,
        m9_legacy_finance: f.finance,
      } as Record<string, unknown>
    )[name],
    error: null,
  }));
});
afterEach(() => vi.useRealTimers());
describe("explicit readonly pilot section", () => {
  it("production is rejected before permission and extraRPC", async () => {
    mocks.enabled = false;
    await expect(
      PilotControl({ overview: fixture().overview }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["customers.manage", "inventory.count"])(
    "denied %s does not dispatch any of3readers",
    async (permission) => {
      mocks.permission.mockImplementation(async (p) => {
        if (p === permission) throw Error("NOT_AUTHORIZED_PRIVATE");
        return { supabase: { rpc: mocks.rpc } };
      });
      const html = renderToStaticMarkup(
        await PilotControl({ overview: fixture().overview }),
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(html).toContain("No se pudo comprobar");
      expect(html).not.toContain("NOT_AUTHORIZED_PRIVATE");
    },
  );
  it("normal route retains one overviewRPC and does not mount extra section", async () => {
    const tree = await Page({});
    const markup = renderToStaticMarkup(tree);
    const controlLink = Children.toArray(tree.props.children).find(
      (node) =>
        isValidElement<{ href?: string; prefetch?: boolean }>(node) &&
        node.props.href === "/migracion/avance?control=piloto#control-piloto",
    );
    expect(
      isValidElement<{ prefetch?: boolean }>(controlLink) &&
        controlLink.props.prefetch === false,
    ).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("m9_parallel_readonly_overview");
    expect(mocks.permission).toHaveBeenCalledTimes(1);
    expect(markup).not.toContain("Cuatro pasos separados");
    expect(markup).toContain("Abrir control único del piloto");
  });
  it("only exact opt-in mounts control; arbitrary URL/query does not", async () => {
    for (const control of [
      "https://evil.test",
      "PILOTO",
      "piloto&action=SAVE",
    ]) {
      const tree = await Page({ searchParams: Promise.resolve({ control }) });
      expect(
        Children.toArray(tree.props.children).some(
          (n) => isValidElement(n) && n.type === PilotControl,
        ),
      ).toBe(false);
    }
    const tree = await Page({
      searchParams: Promise.resolve({ control: "piloto" }),
    });
    expect(
      Children.toArray(tree.props.children).filter(
        (n) => isValidElement(n) && n.type === PilotControl,
      ),
    ).toHaveLength(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(4);
  });
  it("guards both permissions before3existing readonly calls, noforms/defaults/writers/PII", async () => {
    const html = renderToStaticMarkup(
      await PilotControl({ overview: fixture().overview }),
    );
    expect(mocks.permission.mock.calls.map(([p]) => p)).toEqual([
      "customers.manage",
      "inventory.count",
    ]);
    expect(mocks.permission.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0],
    );
    expect(mocks.rpc.mock.calls).toEqual([
      ["m9_legacy_registry_read", { p_input: { q: "", page: 1 } }],
      [
        "m9_delivery_capture_read",
        { p_input: { q: "", filter: "all", page: 1, review_filter: "all" } },
      ],
      ["m9_legacy_finance", { p_action: "LIST" }],
    ]);
    expect(html).toContain("36 datos");
    expect(html).toContain("36 desconocidos");
    expect(html).toContain("7 cuentas");
    expect(html).toContain("no evaluada");
    expect(html).toContain("mayor de 24 horas");
    expect(html).not.toMatch(
      /PRIVATE_SYNTHETIC|219000|<form|<input|SAVE|TRIAL|nonce/,
    );
    expect(html).toContain(
      "Sin coincidencia en el archivo no significa cero compromisos",
    );
  });
  it.each(["null", "reader-error", "metadata", "partial", "stock-drift"])(
    "%s yields not-assessed notice rather than zeros or rawdata",
    async (kind) => {
      const f = fixture();
      if (kind === "metadata")
        f.delivery.source_until = "2026-10-22T18:11:00.000Z";
      if (kind === "partial") f.delivery.total = 83;
      if (kind === "stock-drift") f.registry.stock.pop();
      mocks.rpc.mockImplementation(async (name) => ({
        data:
          kind === "null"
            ? null
            : (
                {
                  m9_legacy_registry_read: f.registry,
                  m9_delivery_capture_read: f.delivery,
                  m9_legacy_finance: f.finance,
                } as Record<string, unknown>
              )[name],
        error:
          kind === "reader-error"
            ? { message: "PRIVATE_SYNTHETIC_RPC_ERROR" }
            : null,
      }));
      const html = renderToStaticMarkup(
        await PilotControl({ overview: f.overview }),
      );
      expect(html).toContain("No se pudo comprobar");
      expect(html).not.toMatch(
        /PRIVATE_SYNTHETIC|0 pendientes|0 cuentas|<form/,
      );
    },
  );
});
