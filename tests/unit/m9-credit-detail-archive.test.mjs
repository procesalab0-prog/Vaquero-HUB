import { it, expect } from "vitest";
import {
  creditDetailArchive,
  creditDetailArchiveSQL,
} from "../../scripts/m9/archive-credit-details.mjs";
const sha = "a".repeat(64),
  accountsSha = "b".repeat(64),
  actor = "11111111-1111-4111-8111-111111111111";
function fixture() {
  return {
    plan: {
      version: "m9-general-credit-details-1",
      project_id: "zsezjtswqeijboezvado",
      production_allowed: false,
      operational_import_allowed: false,
      inventory_import_allowed: false,
      baseline_refreshed: false,
      simultaneous_closing_cut: false,
      issues: [],
      missing_expected: [],
      accounts: [
        {
          client_ref: "source",
          customer_key: "key",
          source_at: "2026-10-22T18:00:00Z",
          used_cents: 100,
          holds: [],
        },
      ],
      documents: [
        {
          client_ref: "source",
          document_key: "doc",
          source_folio: "VSM1",
          source_document_id: "id",
          source_at: "2026-10-22T18:00:00Z",
          source_customer_name: "Nombre histórico",
          total_cents: 100,
          balance_cents: 100,
          paid_to_date_cents: 0,
          due_date: "2026-11-22",
          holds: [],
          linked_history_complete: false,
          source_evidence_sha256: sha,
        },
      ],
      payments: [],
      lines: [
        {
          document_key: "doc",
          line_index: 0,
          barcode: "000123",
          quantity: "1",
          source_description: "Producto",
          variant_id: null,
          holds: ["DELIVERY_NOT_OBSERVED", "BARCODE_NOT_IN_STAGING"],
          delivery_status: "UNKNOWN",
          reserved_qty: null,
          stock_deduction: null,
        },
      ],
      source_from: "2026-10-22T18:00:00Z",
      source_until: "2026-10-22T18:10:00Z",
      inputs: { accounts: accountsSha },
    },
    accounts: [
      {
        client_ref: "source",
        name: "Cuenta actual",
        phone: "private",
        state: "unnecessary",
      },
    ],
  };
}
it("keeps exact barcode, unknown delivery and source dates without contact or operational data", () => {
  const d = fixture();
  const p = creditDetailArchive(d.plan, sha, d.accounts, accountsSha);
  expect(p.accounts[0].documents[0].lines[0].barcode).toBe("000123");
  expect(p.source_until).toBe(d.plan.source_until);
  expect(p.accounts[0].name).toBe("Cuenta actual");
  expect(p.accounts[0].documents[0].historical_name).toBe("Nombre histórico");
  expect(JSON.stringify(p)).not.toMatch(/phone|private|unnecessary/);
  expect(p.operational_import_allowed).toBe(false);
});
it.each([
  "production_allowed",
  "operational_import_allowed",
  "inventory_import_allowed",
  "baseline_refreshed",
  "simultaneous_closing_cut",
])("rejects operating or rewritten scope %s", (field) => {
  const d = fixture();
  d.plan[field] = true;
  expect(() =>
    creditDetailArchive(d.plan, sha, d.accounts, accountsSha),
  ).toThrow("CONCILIATED");
});
it("rejects incomplete or mismatched source pins", () => {
  for (const kind of [
    "issues",
    "missing",
    "holds",
    "sha",
    "accountsSha",
    "duplicateName",
  ]) {
    const d = fixture();
    if (kind === "issues") d.plan.issues = [{}];
    if (kind === "missing") d.plan.missing_expected = ["x"];
    if (kind === "holds") d.plan.accounts[0].holds = ["REVIEW"];
    if (kind === "duplicateName") d.accounts.push(d.accounts[0]);
    expect(() =>
      creditDetailArchive(
        d.plan,
        kind === "sha" ? "invalid" : sha,
        d.accounts,
        kind === "accountsSha" ? "c".repeat(64) : accountsSha,
      ),
    ).toThrow();
  }
});
it("defaults to rollback and uses maintenance function only", () => {
  const d = fixture(),
    p = creditDetailArchive(d.plan, sha, d.accounts, accountsSha);
  const sql = creditDetailArchiveSQL(p, actor);
  expect(sql).toContain("app.m9_archive_credit_details");
  expect(sql).toContain("rollback;");
  expect(sql).not.toContain("insert into public");
  expect(creditDetailArchiveSQL(p, actor, true)).toContain("commit;");
  expect(() => creditDetailArchiveSQL(p, "actor'")).toThrow();
});
