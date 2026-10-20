import { describe, it, expect } from "vitest";
import { validateRenewedOpenAccounts } from "../../scripts/m9/reconcile-customer-pilot.mjs";
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
describe("renewal must use settled, identity-bound source evidence", () => {
  it("compares a partial renewal without pretending to renew all clients", () => {
    const f = fixture();
    expect(
      validateRenewedOpenAccounts(f.plan, f.accounts, f.details, at),
    ).toMatchObject({
      scope: "OPEN_DOCUMENTS_ONLY_NOT_FULL_RENEWAL",
      active_cents: 400,
      cancelled_excluded_cents: 100,
      identity_approved: false,
      delivery_confirmed: false,
    });
  });
  it("rejects retained detail from another document even with the correct title", () => {
    const f = fixture();
    f.details[0].detail_text = f.details[0].detail_text.replace(
      "a".repeat(24),
      "b".repeat(24),
    );
    expect(() =>
      validateRenewedOpenAccounts(f.plan, f.accounts, f.details, at),
    ).toThrow("RENEWED_DOCUMENT_IDENTITY_CHANGED");
  });
  it("rejects a changed account balance, additional folio or absent account", () => {
    const f = fixture();
    f.accounts[0].state = f.accounts[0].state.replace("$6.00", "$5.00");
    expect(() =>
      validateRenewedOpenAccounts(f.plan, f.accounts, f.details, at),
    ).toThrow();
    const g = fixture();
    g.accounts[0].state += '\nbutton "VSM2"';
    expect(() =>
      validateRenewedOpenAccounts(g.plan, g.accounts, g.details, at),
    ).toThrow();
    expect(() =>
      validateRenewedOpenAccounts(g.plan, [], g.details, at),
    ).toThrow();
  });
  it("rejects a new or changed abono rather than replacing the old balance", () => {
    const f = fixture();
    f.details[0].linked_text = f.details[0].linked_text.replace(
      "$4.00",
      "$5.00",
    );
    expect(() =>
      validateRenewedOpenAccounts(f.plan, f.accounts, f.details, at),
    ).toThrow("RENEWED_FINANCIAL_EVIDENCE_CHANGED");
  });
  it("rejects expired capture and incomplete linked-payment tables", () => {
    const f = fixture();
    f.details[0].captured_at = "2026-10-18T18:00:00Z";
    expect(() =>
      validateRenewedOpenAccounts(f.plan, f.accounts, f.details, at),
    ).toThrow();
    const g = fixture();
    g.details[0].linked_text =
      g.details[0].linked_text.split("10/20/2026 09:")[0];
    expect(() =>
      validateRenewedOpenAccounts(g.plan, g.accounts, g.details, at),
    ).toThrow();
  });
});
