import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("./actions", () => ({ saveLegacyPilotDraft: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("NOT_FOUND");
  },
  redirect: vi.fn(),
}));
import { GET } from "../../app/(workspace)/clientes/heredados-sicar/hoja/route";
import Page from "../../app/(workspace)/clientes/heredados-sicar/page";
function view() {
  const codes = [
    "2396",
    "12769",
    "11871",
    "606204203409",
    "10000",
    "10010",
    "10",
    "13988",
    "10536",
    "10055",
    "13038",
    "11920",
  ];
  return {
    protocol: "m9-legacy-registry-page-1",
    read_only: true,
    registered: 0,
    general_archived: 0,
    total: 0,
    page: 1,
    pages: 1,
    customers: [],
    stock: codes.map((barcode, i) => ({
      barcode,
      name: "Synthetic QA",
      variant_id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
      location_id: "467765fe-d18e-43bb-be68-326adbf05ce1",
      observed_qty: 40,
      observed_at: "2026-10-20T14:00:00.000Z",
      physical_qty: null,
      sold_waiting_qty: null,
      separated_qty: null,
      revision: 1,
      catalog_current: true,
      balance_current: true,
      field_source_sha256: "a".repeat(64),
      note: "Synthetic source",
    })),
  };
}
function emptyDocuments() {
  return {
    protocol: "m9-delivery-review-page-1",
    ready: true,
    read_only: true,
    responses_enabled: false,
    operational_import_allowed: false,
    archive_sha256: "b".repeat(64),
    source_from: "2026-10-22T18:00:00.000Z",
    source_until: "2026-10-22T18:00:00.000Z",
    source_older_than_24h: true,
    summary: {
      documents: 0,
      lines: 0,
      unknown_documents: 0,
      unknown_lines: 0,
      raw_mapped_lines: 0,
      raw_unmapped_lines: 0,
      live_documentary_links: 0,
      effective_documentary_identities: 0,
      observed_documents: 0,
    },
    total: 0,
    page: 1,
    pages: 1,
    page_size: 8,
    rows: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.permission.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockImplementation(async (name) => ({
    data: name === "m9_legacy_registry_read" ? view() : emptyDocuments(),
    error: null,
  }));
});
describe("pilot sheet read-only server boundary", () => {
  it("rejects production before authorization or any RPC", async () => {
    mocks.enabled = false;
    expect((await GET()).status).toBe(404);
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires inventory.count before the existing reader", async () => {
    mocks.permission.mockRejectedValue(Error("NOT_AUTHORIZED"));
    await expect(GET()).rejects.toThrow("NOT_AUTHORIZED");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses only existing reader, no caching/scripts and no client PII", async () => {
    const data = {
      ...view(),
      customers: [{ name: "PRIVATE CUSTOMER", phone: "PRIVATE PHONE" }],
    };
    mocks.rpc.mockImplementation(async (name) => ({
      data: name === "m9_legacy_registry_read" ? data : emptyDocuments(),
      error: null,
    }));
    const response = await GET(),
      html = await response.text();
    expect(response.status).toBe(200);
    expect(mocks.permission).toHaveBeenCalledWith("inventory.count");
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "m9_legacy_registry_read", {
      p_input: { q: "", page: 1 },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(html).not.toContain("PRIVATE");
    expect(html).toContain("12 códigos / 36 campos");
    expect(html).not.toContain("<script");
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "m9_delivery_review_read", {
      p_input: { q: "", filter: "all", page: 1 },
    });
    expect(html).toContain(
      "Sin coincidencia en este archivo histórico; compromisos actuales no evaluados",
    );
  });
  it.each(["permission", "archive-drift", "unavailable"])(
    "refuses partial printable output after documentary %s",
    async (kind) => {
      let reads = 0;
      mocks.rpc.mockImplementation(async (name) => {
        if (name === "m9_legacy_registry_read")
          return { data: view(), error: null };
        reads++;
        const data = emptyDocuments();
        if (kind === "permission")
          return { data: null, error: { code: "42501", message: "PRIVATE" } };
        if (kind === "archive-drift" && reads > 1)
          data.archive_sha256 = "c".repeat(64);
        if (kind === "unavailable") data.ready = false;
        return { data, error: null };
      });
      const response = await GET(),
        html = await response.text();
      expect(response.status).toBe(409);
      expect(html).toContain("no se generó una lista parcial");
      expect(html).not.toMatch(/PRIVATE|<table|Físico total/);
    },
  );
  it.each(["permission", "error", "protocol", "not-read-only", "scope"])(
    "fails closed for%s",
    async (kind) => {
      const data = view();
      let error: null | { code: string; message: string } = null;
      if (kind === "permission") error = { code: "42501", message: "PRIVATE" };
      if (kind === "error") error = { code: "500", message: "PRIVATE" };
      if (kind === "protocol") data.protocol = "other";
      if (kind === "not-read-only") data.read_only = false;
      if (kind === "scope") data.stock.pop();
      mocks.rpc.mockResolvedValue({ data, error });
      const response = await GET();
      expect(response.status).toBe(
        kind === "permission" ? 404 : kind === "scope" ? 409 : 503,
      );
      expect(await response.text()).not.toContain("PRIVATE");
    },
  );
  it("shows36 unknown and countdefinitions in the existing page", async () => {
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("0 de 36 campos");
    expect(html).toContain("36 desconocidos");
    expect(html).toContain("/clientes/heredados-sicar/hoja");
    expect(html).toContain("Ésta es la definición del nuevo conteo");
    expect(html).toContain("Una búsqueda sin");
    expect(html).toContain("Comparación física pendiente.");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
