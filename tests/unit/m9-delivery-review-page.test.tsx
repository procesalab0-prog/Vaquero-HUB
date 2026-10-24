import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  deliveryReviewQuery,
  deliveryEvidenceHref,
  deliveryReviewPageHref,
  isDeliveryReviewPage,
  type DeliveryReviewPage,
} from "@/lib/m9-delivery-review";
import { CUSTOMER_REVIEW_STAGING_URL } from "@/lib/customer-migration";
import type { DeliveryCapturePage } from "@/lib/m9-delivery-capture";
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  rpc: vi.fn(),
  notFound: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.permission,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("../../app/(workspace)/migracion/entregas/capture-form", () => ({
  DeliveryCaptureForm: (props: {
    document: string;
    requestId: string;
    revokeRequestId: string;
    compact?: boolean;
  }) => {
    mocks.capture(props);
    return (
      <div data-documentary-form={props.document}>
        Captura documental sin operación física
      </div>
    );
  },
}));
import Page from "../../app/(workspace)/migracion/entregas/page";
import CreditPage from "../../app/(workspace)/migracion/creditos/page";
const ref = "11111111-1111-4111-8111-111111111111",
  key = "a".repeat(64);
function originalSample(): DeliveryReviewPage {
  return {
    protocol: "m9-delivery-review-page-1",
    ready: true,
    read_only: true,
    responses_enabled: false,
    operational_import_allowed: false,
    archive_sha256: "b".repeat(64),
    source_from: "2026-10-22T18:00:00.000Z",
    source_until: "2026-10-22T18:10:00.000Z",
    source_older_than_24h: true,
    summary: {
      documents: 84,
      lines: 183,
      unknown_documents: 84,
      unknown_lines: 183,
      raw_mapped_lines: 166,
      raw_unmapped_lines: 17,
      live_documentary_links: 1,
      effective_documentary_identities: 167,
      observed_documents: 0,
    },
    total: 84,
    page: 1,
    pages: 11,
    page_size: 8,
    rows: [
      {
        document_key: key,
        customer_key: "c".repeat(64),
        client_ref: ref,
        account_name: "SYNTHETIC NAME",
        historical_name: "SYNTHETIC NAME",
        folio: "SYNTHETIC SAME FOLIO",
        source_document_id: "d".repeat(24),
        source_at: "2026-10-22T18:05:00.000Z",
        source_evidence_sha256: "e".repeat(64),
        source_delivery_status: "UNKNOWN",
        documentary_statement: "UNKNOWN",
        observation_revision: 0,
        raw_mapped_lines: 0,
        live_documentary_links: 1,
        unresolved_identity_lines: 1,
        generic_lines: 1,
        lines: [
          {
            index: 0,
            barcode: "000123",
            description: "SYNTHETIC PRODUCT",
            source_quantity: "1",
            generic_debt: false,
            source_delivery_status: "UNKNOWN",
            identity_kind: "SIDECAR",
            sidecar_status: "LIVE_EXACT",
          },
          {
            index: 1,
            barcode: "SX00000",
            description: "SYNTHETIC GENERIC DEBT",
            source_quantity: "2",
            generic_debt: true,
            source_delivery_status: "UNKNOWN",
            identity_kind: "UNRESOLVED",
            sidecar_status: "UNREVIEWED",
          },
        ],
      },
    ],
  };
}
function sample(): DeliveryCapturePage {
  const v = originalSample();
  return {
    ...v,
    protocol: "m9-delivery-capture-page-1",
    responses_enabled: true,
    documentary_only: true,
    stock_delivery_allowed: false,
    financial_opening_allowed: false,
    summary: {
      ...v.summary,
      concrete_documentary_reviews: 0,
      pending_documentary_reviews: 84,
    },
    rows: v.rows.map((d) => ({
      ...d,
      capture_context: {
        archive_payload_hash: "1".repeat(64),
        document_snapshot_hash: "2".repeat(64),
        revision: 0,
        latest_request_id: null,
        latest_action: null,
        status: "NONE",
      },
    })),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", CUSTOMER_REVIEW_STAGING_URL);
  mocks.notFound.mockImplementation(() => {
    throw Error("NOT_FOUND");
  });
  mocks.permission.mockResolvedValue({
    profile: { is_active: true, roles: { code: "ADMIN" } },
    supabase: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({ data: sample(), error: null });
});
afterEach(() => vi.unstubAllEnvs());
const render = async (params = {}) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
it("protects production and any other URL before reading a session or RPC", async () => {
  for (const url of [
    "https://drubkjlmfbdeglucakmg.supabase.co",
    CUSTOMER_REVIEW_STAGING_URL + "/",
    "",
  ]) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    await expect(render()).rejects.toThrow("NOT_FOUND");
  }
  expect(mocks.permission).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("requires customers.manage before accessing any source", async () => {
  mocks.permission.mockRejectedValue(Error("NOT_AUTHORIZED"));
  await expect(render()).rejects.toThrow("NOT_AUTHORIZED");
  expect(mocks.permission).toHaveBeenCalledWith("customers.manage");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["CASHIER", "MANAGER", "WAREHOUSE"])(
  "a permitted %s is still not an ADMIN reader",
  async (code) => {
    mocks.permission.mockResolvedValue({
      profile: { roles: { code } },
      supabase: { rpc: mocks.rpc },
    });
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it("handles the array role relation and makes one read call only", async () => {
  mocks.permission.mockResolvedValue({
    profile: { roles: [{ code: "ADMIN" }] },
    supabase: { rpc: mocks.rpc },
  });
  await render({ q: "000123", filter: "sidecar", page: "2" });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    "m9_delivery_capture_read",
    {
      p_input: {
        q: "000123",
        filter: "sidecar",
        page: 2,
        review_filter: "pending",
      },
    },
  );
});
it("database denial does not render private content", async () => {
  mocks.rpc.mockResolvedValue({ data: sample(), error: { code: "42501" } });
  await expect(render()).rejects.toThrow("NOT_FOUND");
});
it("fails closed if a capture response claims to enable stock", async () => {
  mocks.rpc.mockResolvedValue({
    data: { ...sample(), stock_delivery_allowed: true },
    error: null,
  });
  await expect(render()).rejects.toThrow("No se pudo consultar");
});
it("keeps a missing archive inert", async () => {
  mocks.rpc.mockResolvedValue({
    data: {
      protocol: "m9-delivery-capture-page-1",
      documentary_only: true,
      stock_delivery_allowed: false,
      financial_opening_allowed: false,
      ready: false,
      read_only: true,
      responses_enabled: true,
      operational_import_allowed: false,
    },
    error: null,
  });
  const html = await render();
  expect(html).toContain("todavía no está disponible");
  expect(html).not.toContain("SYNTHETIC NAME");
});
it("one question covers all lines of its exact document", async () => {
  const html = await render();
  expect(
    html.match(/¿Qué mercancía de este documento ya se entregó\?/g),
  ).toHaveLength(1);
  expect(html).toContain("SYNTHETIC NAME");
  expect(html).toContain("Folio SYNTHETIC SAME FOLIO");
  expect(html).toContain("000123");
  expect(html).toContain("SX00000");
  expect(html).toContain("todos sus productos juntos");
});
it("separates archive identities from the additional reviewed sidecar", async () => {
  const html = await render();
  expect(html).toContain("166 / 183");
  expect(html).toContain("17 quedaron sin variante");
  expect(html).toContain("167 identidades");
  expect(html).toContain("Identidad documental adicional vigente");
  expect(html).toContain("no acredita su entrega");
});
it("does not turn generic debt quantity into physical pieces", async () => {
  const html = await render();
  expect(html).toContain("No identifica piezas físicas");
  expect(html).not.toContain("Cantidad anotada en origen: 2");
  expect(html).not.toContain("2 pza");
});
it("keeps the GET search separate from one documentary form per document", async () => {
  const html = await render();
  expect(html).toContain('method="get"');
  expect(html).toContain('data-documentary-form="' + key + '"');
  expect(html).toContain("no registra entregas, cobros ni movimientos");
  expect(html).toContain("Documentos por revisar");
});
it("evidence links preserve client UUID and full document key", async () => {
  const html = await render();
  expect(html).toContain(`q=${ref}&amp;document=${key}&amp;delivery_return=1`);
  expect(html).toContain(`#documento-${key}`);
  expect(html).not.toContain("file://");
  expect(html).not.toContain("outputs/");
});
it("does not merge equal names or folios across different accounts", async () => {
  const v = sample();
  v.rows.push({
    ...structuredClone(v.rows[0]),
    document_key: "f".repeat(64),
    client_ref: "22222222-2222-4222-8222-222222222222",
  });
  mocks.rpc.mockResolvedValue({ data: v, error: null });
  const html = await render();
  expect(
    html.match(/¿Qué mercancía de este documento ya se entregó\?/g),
  ).toHaveLength(2);
  expect(html).toContain("document=" + key);
  expect(html).toContain("document=" + "f".repeat(64));
});
it("escapes source descriptions and keeps them as text", async () => {
  const v = sample();
  v.rows[0].lines[0].description = "<script>alert('x')</script>";
  mocks.rpc.mockResolvedValue({ data: v, error: null });
  const html = await render();
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});
it("paginates documents while retaining filters", () => {
  const q = deliveryReviewQuery({
    q: "000123",
    filter: "identity",
    page: "2",
    document: key,
  });
  const href = deliveryReviewPageHref(q, 3);
  expect(href).toContain("q=000123");
  expect(href).toContain("filter=identity");
  expect(href).toContain("page=3");
  expect(href).toContain("document=" + key);
});
it.each(["0", "-1", "1.2", "NaN", "1000000"])(
  "normalizes invalid page %s without an unsafe RPC input",
  (value) => {
    expect(deliveryReviewQuery({ page: value }).page).toBe(1);
  },
);
it("does not build evidence links from malformed identities", () => {
  expect(() =>
    deliveryEvidenceHref({ client_ref: "../../clients", document_key: key }),
  ).toThrow("DELIVERY_DOCUMENT_IDENTITY_INVALID");
});
it("rejects duplicate line/document identity and inconsistent summary counts", () => {
  const v = originalSample();
  expect(isDeliveryReviewPage(v)).toBe(true);
  v.rows[0].lines[1].index = 0;
  expect(isDeliveryReviewPage(v)).toBe(false);
  const d = originalSample();
  d.rows.push(structuredClone(d.rows[0]));
  expect(isDeliveryReviewPage(d)).toBe(false);
  const counts = originalSample();
  counts.summary.effective_documentary_identities = 183;
  expect(isDeliveryReviewPage(counts)).toBe(false);
});
it("evidence opens the exact document and its account without inferring generic units", async () => {
  const doc = {
    key,
    folio: "SYNTHETIC EVIDENCE",
    source_id: "d".repeat(24),
    source_at: "2026-10-22T18:00:00.000Z",
    historical_name: "SYNTHETIC NAME",
    total_cents: 100,
    balance_cents: 100,
    paid_cents: 0,
    due_date: null,
    holds: [],
    linked_history_complete: false,
    payments: [],
    lines: [
      {
        index: 0,
        barcode: "SX00000",
        quantity: "2",
        description: "SYNTHETIC GENERIC DEBT",
        variant_id: null,
        holds: ["DELIVERY_NOT_OBSERVED", "LEGACY_GENERIC_DEBT_LINE"],
      },
    ],
  };
  mocks.rpc.mockResolvedValue({
    error: null,
    data: {
      ready: true,
      source_from: doc.source_at,
      source_until: doc.source_at,
      source_older_than_24h: false,
      page: 1,
      pages: 2,
      total: 2,
      rows: [
        {
          key: "c".repeat(64),
          ref,
          name: "SYNTHETIC NAME",
          balance_cents: 100,
          documents: [doc],
        },
      ],
      summary: {
        accounts: 1,
        documents: 1,
        open_documents: 1,
        paid_documents: 0,
        observed_balance_cents: 100,
        historical_payments: 0,
        cancelled_payments: 0,
        cancelled_cents: 0,
        active_paid_cents: 0,
        credit_lines: 1,
        mapped_lines: 0,
        unmapped_lines: 1,
        review_documents: 0,
      },
    },
  });
  const html = renderToStaticMarkup(
    await CreditPage({
      searchParams: Promise.resolve({ q: ref, document: key }),
    }),
  );
  expect(html).toContain(`id="documento-${key}" open=""`);
  expect(html.match(/<details[^>]* open=""/g)).toHaveLength(2);
  expect(html).toContain("Renglón contable; cantidad física sin confirmar");
  expect(html).not.toContain("2 pza");
  expect(html).not.toContain("Volver a la misma tanda");
  mocks.rpc.mockClear();
  const contextual = renderToStaticMarkup(
    await CreditPage({
      searchParams: Promise.resolve({
        q: ref,
        document: key,
        delivery_return: "1",
        delivery_q: "SYNTHETIC SEARCH",
        delivery_filter: "sidecar",
        delivery_page: "2",
        delivery_review_filter: "all",
      }),
    }),
  );
  expect(contextual).toContain(
    'href="/migracion/entregas?q=SYNTHETIC+SEARCH&amp;filter=sidecar&amp;page=2&amp;review_filter=all#documentos"',
  );
  expect(contextual).toContain('name="delivery_page" value="2"');
  expect(contextual).toContain(
    `href="/migracion/creditos?q=${ref}&amp;filter=all&amp;page=2&amp;delivery_return=1`,
  );
  expect(contextual).not.toContain("data-documentary-form=");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("m9_credit_detail_read", {
    p_input: { q: ref, filter: "all", page: 1 },
  });
});
it("renders a bounded batch worksheet with separate physical and opening status", async () => {
  const html = await render();
  expect(html).toContain("<table");
  expect(html).toContain(
    "Hoja de esta tanda: 1 folios y 2 renglones de origen",
  );
  expect(html).toContain("No evaluada en esta hoja");
  expect(html).toContain("UNKNOWN · Sin confirmar");
  expect(html).toContain("incluso «todo entregado»");
  expect(html.match(/data-documentary-form=/g)).toHaveLength(1);
  expect(html).not.toContain("Guardar tanda");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});

it("keeps all eight document contexts independent and never reuses a batch nonce", async () => {
  const v = sample();
  v.rows = Array.from({ length: 8 }, (_, i) => ({
    ...structuredClone(v.rows[0]),
    document_key: String(i + 1).repeat(64),
  }));
  mocks.rpc.mockResolvedValue({ data: v, error: null });
  const html = await render({ page: "3", q: "SYNTHETIC" });
  expect(html).toContain(
    "Hoja de esta tanda: 8 folios y 16 renglones de origen",
  );
  expect(mocks.capture).toHaveBeenCalledTimes(8);
  const props = mocks.capture.mock.calls.map(([p]) => p);
  expect(new Set(props.map((p) => p.document)).size).toBe(8);
  expect(
    new Set(props.flatMap((p) => [p.requestId, p.revokeRequestId])).size,
  ).toBe(16);
  expect(props.every((p) => p.compact === true)).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
