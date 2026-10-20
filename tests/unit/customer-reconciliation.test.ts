import { describe, it, expect } from "vitest";
import {
  reconcileCustomers,
  type ReconciliationGraph,
} from "../../lib/customer-reconciliation";
const at = "2026-10-20T18:00:00Z";
function fixture(): ReconciliationGraph {
  return {
    generated_at: at,
    source_at: "2026-10-20T14:00:00Z",
    scope: "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS",
    accounts: [
      {
        key: "a",
        name: "Source A",
        used_cents: 600,
        phone_present: true,
        candidates: 1,
        linked: false,
      },
    ],
    documents: [
      {
        key: "d",
        account: "a",
        folio: "SOURCE1",
        status: "OPEN",
        total_cents: 1000,
        paid_cents: 400,
        balance_cents: 600,
        active_payment_cents: 400,
        cancelled_payment_cents: 100,
        payment_count: 2,
        payment_evidence: "ACTIVE_AND_CANCELLED_RECONCILED",
      },
    ],
    lines: [
      {
        document: "d",
        index: 0,
        barcode: "0010",
        quantity: "1.000",
        variant: "v",
        exact_variant: true,
      },
    ],
  };
}
describe("independent reconciliation of customer source", () => {
  it("separates cancelled payments, identity candidates and physical delivery", () => {
    const r = reconcileCustomers(fixture(), ["0010", "10"], at);
    expect(r.financial_pass).toBe(true);
    expect(r.summary.pending_cents).toBe(600);
    expect(r.summary.cancelled_payment_cents).toBe(100);
    expect(r.accounts[0].identity).toBe("CANDIDATE_ONLY");
    expect(r.operational_allowed).toBe(false);
    expect(r.inventory_allowed).toBe(false);
    expect(r.pilot[0].lines).toHaveLength(1);
    expect(r.pilot[1].lines).toHaveLength(0);
    expect(r.pilot[0].importable_qty).toBeNull();
  });
  it("does not count cancelled money as an active payment", () => {
    const g = fixture();
    g.documents[0].active_payment_cents = 500;
    expect(reconcileCustomers(g, ["0010"], at).financial_pass).toBe(false);
  });
  it("rejects a mismatch between account and document debt", () => {
    const g = fixture();
    g.accounts[0].used_cents = 601;
    const r = reconcileCustomers(g, ["0010"], at);
    expect(r.financial_pass).toBe(false);
    expect(r.accounts[0].reconciled).toBe(false);
  });
  it("keeps a paid archive with absent payment detail separate from new debt", () => {
    const g = fixture();
    g.accounts[0].used_cents = 0;
    Object.assign(g.documents[0], {
      status: "PAID",
      paid_cents: 1000,
      balance_cents: 0,
      active_payment_cents: 0,
      payment_count: 0,
      payment_evidence: "NOT_CAPTURED_ARCHIVE_ONLY",
    });
    const r = reconcileCustomers(g, ["0010"], at);
    expect(r.financial_pass).toBe(true);
    expect(r.summary.paid_documents).toBe(1);
    expect(r.summary.unknown_delivery_lines).toBe(1);
  });
  it("cannot assume a phone match is an approved link", () => {
    const g = fixture();
    g.accounts[0].candidates = 3;
    const r = reconcileCustomers(g, ["0010"], at);
    expect(r.summary.linked_accounts).toBe(0);
    expect(r.accounts[0].operational_allowed).toBe(false);
  });
  it("marks the stale cut without altering its timestamp", () => {
    const g = fixture();
    g.source_at = "2026-10-18T14:00:00Z";
    expect(reconcileCustomers(g, ["0010"], at).cut_fresh).toBe(false);
    expect(g.source_at).toBe("2026-10-18T14:00:00Z");
  });
  it("rejects duplicated identities and document keys", () => {
    for (const field of ["accounts", "documents"] as const) {
      const g = fixture();
      if (field === "accounts") g.accounts.push({ ...g.accounts[0] });
      else g.documents.push({ ...g.documents[0] });
      expect(() => reconcileCustomers(g, ["0010"], at)).toThrow(
        "DUPLICATE_SOURCE_IDENTITY",
      );
    }
  });
  it("rejects orphan documents or lines and duplicate line positions", () => {
    const a = fixture();
    a.documents[0].account = "absent";
    expect(() => reconcileCustomers(a, ["0010"], at)).toThrow();
    const b = fixture();
    b.lines[0].document = "absent";
    expect(() => reconcileCustomers(b, ["0010"], at)).toThrow();
    const c = fixture();
    c.lines.push({ ...c.lines[0] });
    expect(() => reconcileCustomers(c, ["0010"], at)).toThrow();
  });
  it("fails reconciliation when a document has no merchandise evidence", () => {
    const g = fixture();
    g.lines = [];
    expect(reconcileCustomers(g, ["0010"], at).financial_pass).toBe(false);
  });
  it("rejects negative, fractional-cent and unsafe amounts", () => {
    for (const n of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
      const g = fixture();
      g.documents[0].balance_cents = n;
      expect(() => reconcileCustomers(g, ["0010"], at)).toThrow();
    }
  });
  it("does not broaden the bounded scope or normalize literal barcodes", () => {
    const g = fixture();
    g.scope = "ALL";
    expect(() => reconcileCustomers(g, ["0010"], at)).toThrow();
    expect(() => reconcileCustomers(fixture(), [" 0010"], at)).toThrow();
    const bad = fixture();
    bad.lines[0].barcode = "0010 ";
    expect(() => reconcileCustomers(bad, ["0010"], at)).toThrow();
  });
  it("excludes a changed exact variant from the exact-link count", () => {
    const g = fixture();
    g.lines[0].exact_variant = false;
    const r = reconcileCustomers(g, ["0010"], at);
    expect(r.summary.exact_variant_lines).toBe(0);
    expect(r.pilot[0].lines[0].mapped).toBe(false);
  });
});
