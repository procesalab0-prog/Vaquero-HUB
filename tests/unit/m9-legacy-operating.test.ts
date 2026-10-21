import { describe, it, expect } from "vitest";
import { operatingRenewal } from "../../scripts/m9/prepare-legacy-operating.mjs";
const at = "2026-10-20T18:00:00Z";
const fixture = () => ({
  plan: {
    customers: [{ customer_key: "c", source_ref: "ref", used_cents: 600 }],
    documents: [
      {
        document_key: "d",
        customer_key: "c",
        source_folio: "VSM1",
        source_document_id: "a".repeat(24),
        financial_status: "OPEN",
        total_cents: 1000,
        balance_cents: 600,
        paid_to_date_cents: 400,
      },
    ],
    payments: [
      {
        document_key: "d",
        source_ref: "Abono 1",
        amount_cents: 400,
        cancelled: false,
      },
      {
        document_key: "d",
        source_ref: "Abono 2",
        amount_cents: 100,
        cancelled: true,
      },
    ],
  },
  accounts: [
    {
      client_ref: "ref",
      captured_at: at,
      state: 'text: Saldo utilizado\n    - paragraph: $6.00\nbutton "VSM1"',
    },
  ],
  details: [
    {
      client_ref: "ref",
      folio: "VSM1",
      captured_at: at,
      detail_text: `VSM1\nCód Doc. ${"a".repeat(24)}\nDocumentos vinculados (2)\nSaldo $6.00\nMXN $10.00`,
      linked_text:
        "Documentos vinculados - Venta VSM 1\n10/20/2026 10:00:00 AM\nAbono 1\n$4.00 MXN\n10/20/2026 09:00:00 AM\nAbono 2\nCancelado 10/20/2026 10:01:00 AM\n$1.00 MXN",
    },
  ],
});

const sample = () => {
  const f = fixture();
  return {
    ...f,
    plan: {
      ...f.plan,
      documents: f.plan.documents.map((d) => ({
        ...d,
        due_date: "2026-10-25",
      })),
    },
    details: f.details.map((d) => ({
      ...d,
      full_reload_before_read: true,
      detail_text: d.detail_text + "\nVence el 10/25/2026",
    })),
    registry: {
      batch: "batch",
      accounts: [{ customer_key: "c", registry_id: "registry" }],
    },
    list: {
      final: { captured_at: at, state: 'APARTADO\n    - button "QA account"' },
    },
  };
};
const run = (f: ReturnType<typeof sample>) =>
  operatingRenewal(
    f.plan,
    f.registry,
    f.accounts,
    f.details,
    f.list,
    at,
    { list: "a".repeat(64), accounts: "b".repeat(64), details: "c".repeat(64) },
    "d".repeat(64),
  );
describe("operating renewal requires complete fresh evidence without refreshing source data", () => {
  it("keeps cancellation excluded and takes the oldest observation as cut", () => {
    const f = sample();
    f.list.final.captured_at = "2026-10-20T17:50:00Z";
    expect(run(f)).toMatchObject({
      scope: "OPEN_DOCUMENTS_ONLY_NOT_FULL_RENEWAL",
      source_at: "2026-10-20T17:50:00.000Z",
      full_customer_directory: false,
      balance_cents: 600,
      active_historical_cents: 400,
      cancelled_excluded_cents: 100,
    });
  });
  it("rejects a partial or still-loading client list", () => {
    for (const state of [
      "APARTADO",
      'APARTADO\n    - button "QA account"\nprogressbar',
    ]) {
      const f = sample();
      f.list.final.state = state;
      expect(() => run(f)).toThrow("RENEWED_LIST_INCOMPLETE");
    }
  });
  it("rejects future and stale final list captures", () => {
    for (const time of ["2026-10-21T18:00:00Z", "2026-10-18T18:00:00Z"]) {
      const f = sample();
      f.list.final.captured_at = time;
      expect(() => run(f)).toThrow("RENEWED_CUT_STALE");
    }
  });
  it("requires a full reload rather than retained SPA document content", () => {
    const f = sample();
    f.details[0].full_reload_before_read = false;
    expect(() => run(f)).toThrow("DOCUMENT_FULL_RELOAD_REQUIRED");
  });
  it("rejects a changed due date even if all amounts still match", () => {
    const f = sample();
    f.details[0].detail_text = f.details[0].detail_text.replace(
      "10/25/2026",
      "10/26/2026",
    );
    expect(() => run(f)).toThrow("RENEWED_DUE_DATE_CHANGED");
  });
  it("recognizes an overdue date without treating it as absent", () => {
    const f = sample();
    f.details[0].detail_text = f.details[0].detail_text.replace(
      "Vence el",
      "Venció el",
    );
    expect(run(f).accounts[0].documents[0].due_date).toBe("2026-10-25");
  });
  it("requires the original registry mapping", () => {
    const f = sample();
    f.registry.accounts = [];
    expect(() => run(f)).toThrow("REGISTRY_REFERENCE_REQUIRED");
  });
});
