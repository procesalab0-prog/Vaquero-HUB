import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { digest } from "../../scripts/m9/acceleration.mjs";
import {
  censusArchive,
  prepareCensusArchive,
} from "../../scripts/m9/archive-general-census.mjs";
const hash = "a".repeat(64),
  at = "2026-10-22T16:00:00Z";
const fixture = () => ({
  version: 1,
  scope: "VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY",
  deleted_customers_included: false,
  paid_history_complete: false,
  financial_details_complete: false,
  operational_import_allowed: false,
  source_at: "2026-10-20T14:00:00Z",
  observed_until: "2026-10-20T15:00:00Z",
  missing_previous_keys: [],
  summary: {
    accounts: 2,
    open_documents: 2,
    source_used_cents: 400,
    document_balance_cents: 400,
    previous_accounts_present: 1,
    new_source_accounts: 1,
    accounts_with_unknown_used: 0,
  },
  accounts: [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ].map((ref, i) => ({
    customer_key: digest({ tenant: "VSM", client_ref: ref }),
    source_ref: ref,
    name: "Nombre repetido de prueba",
    used_cents: 200,
    document_balance_cents: 200,
    list_balance_cents: null,
    overdue_cents: 0,
    source_evidence_sha256: hash,
    source_at: "2026-10-20T14:30:00Z",
    native_customer_id: null,
    privacy_consent: null,
    new_credit_authorized: false,
    operational_import_allowed: false,
    previously_registered: i === 0,
    holds: ["DUPLICATE_NAME_NOT_MERGED"],
    documents: [
      {
        folio: "148",
        document_key: digest({ tenant: "VSM", client_ref: ref, folio: "148" }),
        total_cents: 300,
        balance_cents: 200,
        source_document_id: null,
        delivery_status: "UNKNOWN",
        payment_details_verified: false,
        occurred_label: "01/01/2026 12:00:00 PM",
        evidence_sha256: hash,
      },
    ],
  })),
});
describe("historical census archive", () => {
  it("preserves old dates, distinct IDs and literal folios without inventing links", () => {
    const p = fixture(),
      a = censusArchive(p, hash, at);
    expect(a.source_at).toBe(p.source_at);
    expect(a.accounts).toHaveLength(2);
    expect(new Set(a.accounts.map((x) => x.key)).size).toBe(2);
    expect(
      new Set(a.accounts.flatMap((x) => x.documents.map((d) => d.key))).size,
    ).toBe(2);
    expect(a.accounts.every((a) => a.documents[0].folio === "148")).toBe(true);
    expect(JSON.stringify(a)).not.toContain("native_customer_id");
  });
  for (const [name, change] of Object.entries({
    "operational approval": (p) => (p.operational_import_allowed = true),
    "complete history claim": (p) => (p.paid_history_complete = true),
    "future date": (p) => (p.observed_until = "2026-10-23T00:00:00Z"),
    "missing identity": (p) => (p.accounts[0].source_ref = ""),
    "altered key": (p) => (p.accounts[0].customer_key = hash),
    "duplicate identity": (p) =>
      (p.accounts[1] = structuredClone(p.accounts[0])),
    "assumed native link": (p) =>
      (p.accounts[0].native_customer_id = "invented"),
    "assumed consent": (p) => (p.accounts[0].privacy_consent = true),
    "credit authorization": (p) => (p.accounts[0].new_credit_authorized = true),
    "missing amount": (p) => (p.accounts[0].used_cents = null),
    "assumed delivery": (p) =>
      (p.accounts[0].documents[0].delivery_status = "DELIVERED"),
    "assumed document ID": (p) =>
      (p.accounts[0].documents[0].source_document_id = "invented"),
    "assumed payment review": (p) =>
      (p.accounts[0].documents[0].payment_details_verified = true),
    "changed total": (p) => (p.accounts[0].documents[0].balance_cents = 201),
    "changed summary": (p) => (p.summary.open_documents = 3),
    "unresolved previous account": (p) => (p.missing_previous_keys = [hash]),
  }))
    it(`rejects ${name}`, () => {
      const p = fixture();
      change(p);
      expect(() => censusArchive(p, hash, at)).toThrow();
    });
  it("reproduces pinned output and refuses overwrite or modified source", () => {
    const dir = mkdtempSync(join(tmpdir(), "m9-census-"));
    try {
      const raw = JSON.stringify(fixture()),
        src = join(dir, "source.json"),
        h = createHash("sha256").update(raw).digest("hex");
      writeFileSync(src, raw);
      prepareCensusArchive(src, h, join(dir, "one"), at);
      prepareCensusArchive(src, h, join(dir, "two"), at);
      for (const f of ["payload.json", "ensayo.sql", "carga-staging.sql"])
        expect(readFileSync(join(dir, "one", f), "utf8")).toBe(
          readFileSync(join(dir, "two", f), "utf8"),
        );
      expect(readFileSync(join(dir, "one", "ensayo.sql"), "utf8")).toMatch(
        /rollback;/,
      );
      expect(() =>
        prepareCensusArchive(src, h, join(dir, "one"), at),
      ).toThrow();
      writeFileSync(src, raw + " ");
      expect(() =>
        prepareCensusArchive(src, h, join(dir, "three"), at),
      ).toThrow("CENSUS_SOURCE_CHANGED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
