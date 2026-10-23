import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { historicalCreditEvidence } from "@/lib/migration-credit-evidence";
import { CUSTOMER_REVIEW_STAGING_URL } from "@/lib/customer-migration";
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  rpc: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.permission,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
import Page from "../../app/(workspace)/migracion/page";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function fixture(n = 1) {
  const ref = `00000000-8888-4888-8888-${String(n).padStart(12, "0")}`,
    key = hash({ client_ref: ref, tenant: "VSM" }),
    document = {
      key: hash({ client_ref: ref, folio: "QA-F1", tenant: "VSM" }),
      folio: "QA-F1",
      total_cents: 10000,
      balance_cents: 7000,
    },
    row = {
      key,
      ref,
      name: "SYNTHETIC SAME NAME",
      used_cents: 7000,
      holds: ["PREVIOUS_BALANCE_CHANGED"],
      documents: [document],
    },
    body = {
      key,
      ref,
      name: row.name,
      source_at: "2026-10-22T18:02:00.000+00:00",
      balance_cents: 7000,
      documents: [
        {
          ...document,
          source_id: String(n).padStart(24, "0"),
          evidence_sha256: "b".repeat(64),
          source_at: "2026-10-22T18:03:00.000+00:00",
          paid_cents: 3000,
          historical_name: row.name,
          holds: [],
          linked_history_complete: true,
          payments: [
            {
              key: hash({
                source_ref: "Abono 1",
                tenant: "VSM",
              }),
              ref: "Abono 1",
              evidence_sha256: "c".repeat(64),
              amount_cents: 3000,
              cancelled: false,
            },
          ],
          lines: [
            {
              barcode: "000123",
              delivery_status: "UNKNOWN",
              reserved_qty: null,
              stock_deduction: null,
            },
          ],
        },
      ],
    },
    response = {
      ready: true,
      historical: true,
      operational_import_allowed: false,
      archive: "a".repeat(64),
      source_from: "2026-10-22T18:00:00.000+00:00",
      source_until: "2026-10-22T18:05:00.000+00:00",
      total: 1,
      page: 1,
      pages: 1,
      summary: {
        archive: "a".repeat(64),
        operational_import_allowed: false,
        accounts: 60,
        documents: 84,
      },
      rows: [body],
    };
  return { row, response, body };
}
describe("historical financial evidence badge", () => {
  it("requires a complete unique account response and returns its own evidence interval", () => {
    const f = fixture(),
      before = JSON.stringify(f);
    expect(historicalCreditEvidence(f.row, f.response)).toEqual({
      archive: "a".repeat(64),
      source_from: "2026-10-22T18:02:00.000Z",
      source_until: "2026-10-22T18:03:00.000Z",
    });
    expect(JSON.stringify(f)).toBe(before);
  });
  it.each([
    { total: 2 },
    { page: 2 },
    { pages: 2 },
    { rows: [] },
    { rows: null },
    { ready: false },
    { historical: false },
    { operational_import_allowed: true },
    { source_from: "2026-02-31T00:00:00.000Z" },
    { source_until: "2026-10-22T18:01:00.000Z" },
    { summary: { archive: "a".repeat(64) } },
  ])("rejects incomplete/invalid RPC response %#", (change) => {
    const f = fixture();
    expect(
      historicalCreditEvidence(f.row, { ...f.response, ...change }),
    ).toBeNull();
  });
  it.each([
    "other_uuid",
    "wrong_key",
    "other_folio",
    "total_drift",
    "balance_drift",
    "payment_drift",
    "cancelled_active",
    "source_id_review",
    "physical_effect",
    "missing_history",
  ])("rejects %s without interpreting debt", (kind) => {
    const f = fixture(),
      d = f.body.documents[0];
    if (kind === "other_uuid") f.body.ref = fixture(2).row.ref;
    if (kind === "wrong_key") f.body.key = "b".repeat(64);
    if (kind === "other_folio") {
      d.folio = "QA-F2";
      d.key = hash({ client_ref: f.row.ref, folio: d.folio, tenant: "VSM" });
    }
    if (kind === "total_drift") {
      d.total_cents++;
      d.paid_cents++;
      d.payments[0].amount_cents++;
    }
    if (kind === "balance_drift") f.body.balance_cents++;
    if (kind === "payment_drift") d.payments[0].amount_cents++;
    if (kind === "cancelled_active") d.payments[0].cancelled = true;
    if (kind === "source_id_review") d.holds = ["SOURCE_ID_CHANGED"] as never[];
    if (kind === "physical_effect") d.lines[0].delivery_status = "DELIVERED";
    if (kind === "missing_history") d.linked_history_complete = false;
    expect(historicalCreditEvidence(f.row, f.response)).toBeNull();
  });
  it("rejects a partial open-document set even when the displayed first folio matches", () => {
    const f = fixture();
    f.row.documents.push({
      ...f.row.documents[0],
      folio: "QA-F2",
      key: hash({ client_ref: f.row.ref, folio: "QA-F2", tenant: "VSM" }),
    });
    expect(historicalCreditEvidence(f.row, f.response)).toBeNull();
  });
  it("zero requires an explicit paid breakdown, never an empty historical list", () => {
    const f = fixture(),
      d = f.body.documents[0];
    f.row.used_cents = f.body.balance_cents = 0;
    f.row.documents = [];
    d.balance_cents = 0;
    d.paid_cents = d.total_cents;
    d.payments[0].amount_cents = d.total_cents;
    expect(historicalCreditEvidence(f.row, f.response)).not.toBeNull();
    f.body.documents = [];
    expect(historicalCreditEvidence(f.row, f.response)).toBeNull();
  });
  it("ignores cancelled amounts in a valid proof, and never labels unrelated holds", () => {
    const f = fixture(),
      p = f.body.documents[0].payments[0];
    f.body.documents[0].payments.push({
      ...p,
      ref: "Abono 2",
      key: hash({ source_ref: "Abono 2", tenant: "VSM" }),
      amount_cents: 500,
      cancelled: true,
    });
    expect(historicalCreditEvidence(f.row, f.response)).not.toBeNull();
    f.row.holds = ["DUPLICATE_NAME_NOT_MERGED"];
    expect(historicalCreditEvidence(f.row, f.response)).toBeNull();
  });
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", CUSTOMER_REVIEW_STAGING_URL);
  mocks.notFound.mockImplementation(() => {
    throw Error("NOT_FOUND");
  });
  mocks.permission.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
});
afterEach(() => vi.unstubAllEnvs());
const census = (rows: ReturnType<typeof fixture>["row"][]) => ({
  source_at: "2026-10-23T02:00:00.000Z",
  observed_until: "2026-10-23T03:00:00.000Z",
  source_older_than_24h: false,
  summary: {
    accounts: 172,
    additional_accounts: 58,
    documents: 84,
    observed_balance_cents: 24295800,
  },
  rows,
  total: rows.length,
  page: 1,
  pages: 1,
  catalog_loaded_codes: 15961,
  legacy_registered: 114,
  legacy_operating_balance_cents: 1191000,
  pilot_codes: 12,
  pilot_pending_fields: 36,
  operating_windows: 0,
});
const render = async () =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
describe("migration page bounded readonly evidence", () => {
  it("keeps original holds and dates while showing a cautious derived match", async () => {
    const f = fixture();
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "m9_general_migration_read" ? census([f.row]) : f.response,
      error: null,
    }));
    const html = await render();
    expect(mocks.permission).toHaveBeenCalledWith("customers.manage");
    expect(mocks.rpc).toHaveBeenCalledWith("m9_credit_detail_read", {
      p_input: { q: f.row.ref, filter: "all", page: 1 },
    });
    expect(html).toContain("Saldo y folios coinciden con el detalle histórico");
    expect(html).toContain("No acredita vigencia, pagos nuevos ni entregas");
    expect(html).toContain("La diferencia queda por revisar");
    expect(html).toContain("/migracion/creditos?q=" + f.row.ref);
  });
  it.each(["error", "reject", "partial"])(
    "RPC %s never hides or resolves the original hold",
    async (kind) => {
      const f = fixture();
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === "m9_general_migration_read")
          return { data: census([f.row]), error: null };
        if (kind === "reject") throw Error("UNAVAILABLE");
        return {
          data: kind === "partial" ? { ...f.response, total: 2 } : null,
          error: kind === "error" ? { message: "UNAVAILABLE" } : null,
        };
      });
      const html = await render();
      expect(html).toContain("La diferencia queda por revisar");
      expect(html).not.toContain("Saldo y folios coinciden");
    },
  );
  it("queries only financial differences, with a hard maximum of 20 independent reads", async () => {
    const rows = Array.from({ length: 22 }, (_, i) => fixture(i + 1).row);
    rows[0].holds = ["DUPLICATE_NAME_NOT_MERGED"];
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "m9_general_migration_read" ? census(rows) : null,
      error: null,
    }));
    await render();
    const reads = mocks.rpc.mock.calls.filter(
      ([name]) => name === "m9_credit_detail_read",
    );
    expect(reads).toHaveLength(20);
    expect(reads.some(([, args]) => args.p_input.q === rows[0].ref)).toBe(
      false,
    );
  });
  it("never queries evidence before staging and permission guards", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://drubkjlmfbdeglucakmg.supabase.co",
    );
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", CUSTOMER_REVIEW_STAGING_URL);
    mocks.permission.mockRejectedValue(Error("NOT_AUTHORIZED"));
    await expect(render()).rejects.toThrow("NOT_AUTHORIZED");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
