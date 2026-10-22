import { it, expect } from "vitest";
import {
  buildGeneralRegistration,
  generalRegistrationSQL,
  GENERAL_SNAPSHOT_TABLES,
  GENERAL_SCOPE,
} from "../../scripts/m9/clientes-general-registration.mjs";
import { digest } from "../../scripts/m9/acceleration.mjs";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prepareGeneralRegistration } from "../../scripts/m9/clientes-general-registration.mjs";
const actor = "11111111-1111-4111-8111-111111111111",
  request = "22222222-2222-4222-8222-222222222222",
  retire = "33333333-3333-4333-8333-333333333333";
const sha = (x) => createHash("sha256").update(x).digest("hex");
function fixture() {
  const accounts = [1, 2, 3].map((n) => {
    const ref = `0000000${n}-1111-4111-8111-111111111111`,
      folio = "VSM" + n,
      p = {
        key: digest({ tenant: "VSM", source_ref: "Abono " + n }),
        ref: "Abono " + n,
        amount_cents: n === 3 ? 1000 : 300,
        cancelled: false,
      };
    return {
      key: digest({ tenant: "VSM", client_ref: ref }),
      ref,
      name: "SYNTHETIC PRIVATE NAME " + n,
      balance_cents: n === 3 ? 0 : 700,
      source_at: "2026-09-23T00:00:00.000Z",
      documents: [
        {
          key: digest({ tenant: "VSM", client_ref: ref, folio }),
          folio,
          total_cents: 1000,
          balance_cents: n === 3 ? 0 : 700,
          paid_cents: n === 3 ? 1000 : 300,
          payments: [p],
          lines: [
            {
              barcode: "000123",
              quantity: "1",
              delivery_status: "UNKNOWN",
              reserved_qty: null,
              stock_deduction: null,
            },
          ],
        },
      ],
    };
  });
  return {
    archive: {
      protocol: "m9-credit-detail-archive-1",
      source_plan_sha256: "a".repeat(64),
      source_from: "2026-09-23T00:00:00.000Z",
      source_until: "2026-09-23T00:00:00.000Z",
      operational_import_allowed: false,
      accounts,
    },
    archive_payload_hash: "b".repeat(64),
    destination: {
      project_id: "zsezjtswqeijboezvado",
      complete: true,
      sources: [{ customer_key: accounts[0].key }],
    },
    audit: GENERAL_SNAPSHOT_TABLES.map((name) => ({
      name,
      rows: 0,
      md5: "c".repeat(32),
    })),
    request_id: request,
  };
}
it("prepares exact missing whole accounts without reopening the paid or existing account", () => {
  const f = fixture(),
    before = JSON.stringify(f),
    p = buildGeneralRegistration(f);
  expect(p.expected_additions).toEqual({
    accounts: 1,
    documents: 1,
    payments: 1,
    lines: 1,
    balance_cents: 700,
  });
  expect(p.operational_import_allowed).toBe(false);
  expect(JSON.stringify(p)).not.toContain("SYNTHETIC PRIVATE NAME");
  expect(JSON.stringify(p)).not.toContain("000123");
  expect(p).not.toHaveProperty("customers");
  expect(p).not.toHaveProperty("consent");
  expect(JSON.stringify(f)).toBe(before);
  expect(GENERAL_SCOPE).toBe("GENERAL_ARCHIVED_INDEBTED_SUBSET");
});
it.each([
  "production",
  "incomplete",
  "invalid_request",
  "unknown_archive",
  "operational",
  "duplicate_account",
  "wrong_account_key",
  "duplicate_document",
  "wrong_document_key",
  "negative",
  "arithmetic",
  "account_balance",
  "duplicate_payment",
  "wrong_payment_key",
  "payment_sum",
  "payment_cancelled_null",
  "delivery",
  "invented_reservation",
  "numeric_barcode",
  "trimmed_barcode",
  "audit_missing",
  "audit_duplicate",
  "audit_hash",
  "audit_negative",
])("rejects invalid registration plan %s", (kind) => {
  const f = fixture(),
    a = f.archive.accounts[1],
    d = a.documents[0];
  if (kind === "production") f.destination.project_id = "drubkjlmfbdeglucakmg";
  if (kind === "incomplete") f.destination.complete = false;
  if (kind === "invalid_request") f.request_id = "wrong";
  if (kind === "unknown_archive") f.archive.source_plan_sha256 = "wrong";
  if (kind === "operational") f.archive.operational_import_allowed = true;
  if (kind === "duplicate_account") f.archive.accounts.push(a);
  if (kind === "wrong_account_key") a.key = "f".repeat(64);
  if (kind === "duplicate_document") a.documents.push(d);
  if (kind === "wrong_document_key") d.key = "f".repeat(64);
  if (kind === "negative") d.balance_cents = -1;
  if (kind === "arithmetic") d.total_cents++;
  if (kind === "account_balance") a.balance_cents++;
  if (kind === "duplicate_payment") d.payments.push(d.payments[0]);
  if (kind === "wrong_payment_key") d.payments[0].key = "f".repeat(64);
  if (kind === "payment_sum") d.payments[0].amount_cents++;
  if (kind === "payment_cancelled_null") d.payments[0].cancelled = null;
  if (kind === "delivery") d.lines[0].delivery_status = "DELIVERED";
  if (kind === "invented_reservation") d.lines[0].reserved_qty = 0;
  if (kind === "numeric_barcode") d.lines[0].barcode = 123;
  if (kind === "trimmed_barcode") d.lines[0].barcode = " 000123";
  if (kind === "audit_missing") f.audit.pop();
  if (kind === "audit_duplicate") f.audit.push(f.audit[0]);
  if (kind === "audit_hash") f.audit[0].md5 = "invalid";
  if (kind === "audit_negative") f.audit[0].rows = -1;
  expect(() => buildGeneralRegistration(f)).toThrow();
});
it("preserves cancelled payment evidence while excluding it from the active reconciliation", () => {
  const f = fixture(),
    d = f.archive.accounts[1].documents[0],
    p = { ref: "Abono cancelado", amount_cents: 100, cancelled: true };
  p.key = digest({ tenant: "VSM", source_ref: p.ref });
  d.payments.push(p);
  expect(buildGeneralRegistration(f).expected_additions.payments).toBe(2);
  expect(buildGeneralRegistration(f).expected_additions.balance_cents).toBe(
    700,
  );
});
it("does not silently regenerate a different plan when there are no missing indebted accounts", () => {
  const f = fixture();
  f.destination.sources.push({ customer_key: f.archive.accounts[1].key });
  expect(() => buildGeneralRegistration(f)).toThrow(
    "NO_MISSING_INDEBTED_ACCOUNTS",
  );
});
it("emits explicit rollback rehearsals and a distinct logical-retirement trial", () => {
  const p = buildGeneralRegistration(fixture()),
    sql = generalRegistrationSQL(p, actor, retire),
    reverse = generalRegistrationSQL(p, actor, retire, { retire: true });
  expect(sql).toContain("rollback;");
  expect(sql).not.toContain("commit;");
  expect(sql).not.toContain("m9_retire_general");
  expect(reverse).toContain("m9_retire_general_customer_registration");
  expect(reverse).toContain("rollback;");
  expect(reverse).not.toMatch(
    /delete\s+from|insert\s+into|update\s+\w|create_sale\s*\(/i,
  );
  expect(generalRegistrationSQL(p, actor, retire, { commit: true })).toContain(
    "commit;",
  );
  expect(() =>
    generalRegistrationSQL(
      { ...p, request_id: "');drop table x;--" },
      actor,
      retire,
    ),
  ).toThrow();
});
it("pins every input and produces byte-identical inert payloads while preserving archive dates", () => {
  const root = mkdtempSync(join(tmpdir(), "m9-general-"));
  try {
    const f = fixture(),
      inputs = {};
    for (const k of ["archive", "destination", "audit"]) {
      const raw = JSON.stringify(f[k]);
      writeFileSync(join(root, k + ".json"), raw);
      inputs[k] = { path: k + ".json", sha256: sha(raw) };
    }
    const cfg = {
      project_id: "zsezjtswqeijboezvado",
      actor_id: actor,
      request_id: request,
      retire_request_id: retire,
      archive_payload_hash: f.archive_payload_hash,
      inputs,
    };
    writeFileSync(join(root, "config.json"), JSON.stringify(cfg));
    const r = prepareGeneralRegistration(
      join(root, "config.json"),
      join(root, "one"),
    );
    prepareGeneralRegistration(join(root, "config.json"), join(root, "two"));
    expect(r.source_from).toBe("2026-09-23T00:00:00.000Z");
    expect(r.debt_opened_cents).toBe(0);
    expect(r.auth_accounts_created).toBe(0);
    expect(r.source_dates_preserved).toBe(true);
    expect(readFileSync(join(root, "one/sha256.json"), "utf8")).toBe(
      readFileSync(join(root, "two/sha256.json"), "utf8"),
    );
    writeFileSync(join(root, "archive.json"), "{}");
    expect(() =>
      prepareGeneralRegistration(
        join(root, "config.json"),
        join(root, "three"),
      ),
    ).toThrow("INPUT_CHANGED:archive");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("the preparer has no network or database execution path", () => {
  const text = readFileSync(
    new URL(
      "../../scripts/m9/clientes-general-registration.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  expect(text).not.toMatch(/fetch\(|\.query\(|createClient\(|https?:\/\//);
});
