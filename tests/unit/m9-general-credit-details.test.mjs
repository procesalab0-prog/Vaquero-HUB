import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { digest } from "../../scripts/m9/acceleration.mjs";
import {
  creditDetailLines,
  paymentBreakdownEntries,
  reconcileGeneralCredit,
  generalCreditDetailSQL,
  prepareGeneralCreditDetails,
} from "../../scripts/m9/reconcile-general-credit-details.mjs";
const at = "2026-10-22T18:00:00Z",
  ref = "11111111-1111-4111-8111-111111111111",
  variant = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const key = digest({ tenant: "VSM", client_ref: ref, folio: "VSM1" });
  return {
    project_id: "zsezjtswqeijboezvado",
    queue: [
      {
        client_ref: ref,
        folio: "VSM1",
        expected_name: "Cliente ejemplo",
        document_key: key,
        expected_total_cents: 100000,
        expected_balance_cents: 70000,
        expected_source_document_id: null,
        delivery_status: "UNKNOWN",
        operational_import_allowed: false,
      },
    ],
    accounts: [
      {
        client_ref: ref,
        name: "Cliente ejemplo",
        captured_at: at,
        full_reload_before_read: true,
        state: "- text: Saldo utilizado\n- paragraph: $700.00",
        table_folios: ["VSM1"],
        unexpected_folios: [],
      },
    ],
    details: [
      {
        client_ref: ref,
        folio: "VSM1",
        document_key: key,
        captured_at: at,
        full_reload_before_read: true,
        delivery_status: "UNKNOWN",
        detail_text:
          "VSM1\nCód Doc. 6ad51050b2f77f4eba62982d\nCliente:\n\nCliente ejemplo\n\nAlmacén:\n\nDEFAULT\n\nDocumentos vinculados (1)\n\n1 PZA\n\n000123\n\nMODELOT.M\n\n$1,000.00\n\n$1,000.00\n\nFormas de Pago/Abonos\n\nSaldo $700.00\nVence el 11/17/2026\nMXN $1,000.00\nSubtotal $1,000.00",
        linked_text:
          "Documentos vinculados - Venta VSM 1\n\n10/21/2026 01:00:00 PM\nAbono 1\nCliente ejemplo\n$300.00 MXN",
        payment_text:
          "Forma de pago\nFolio\n\nVSM 1\n\n10/21/2026 01:00:00 PM\n\nAbono 1\nCaja 1\nEfectivo\n$300.00 MXN\nSaldo $700.00\nTotal $1,000.00 MXN\nAbono total: $300.00 MXN\nSaldo: $700.00",
      },
    ],
    mapping: {
      project_id: "zsezjtswqeijboezvado",
      captured_at: at,
      rows: [{ barcode: "000123", variants: [variant] }],
    },
  };
}
const run = (d) => reconcileGeneralCredit(d, at);
it("reconciles source debt, literal zero-prefixed barcode and historical payment without operating", () => {
  const p = run(fixture());
  expect(p.summary.accounts_reconciled).toBe(1);
  expect(p.lines[0]).toMatchObject({
    barcode: "000123",
    variant_id: variant,
    reserved_qty: null,
    stock_deduction: null,
    delivery_status: "UNKNOWN",
  });
  expect(p.payments[0].replay_as_cash).toBe(false);
  expect(p.operational_import_allowed).toBe(false);
  expect(p.baseline_refreshed).toBe(false);
});
it.each([
  "production",
  "stale_mapping",
  "duplicate_queue",
  "duplicate_detail",
  "duplicate_account",
  "trimmed_code",
  "invented_delivery",
  "stale_detail",
  "wrong_source_key",
])("rejects invalid scope %s", (kind) => {
  const d = fixture();
  if (kind === "production") d.project_id = "drubkjlmfbdeglucakmg";
  if (kind === "stale_mapping") d.mapping.captured_at = "2026-10-20T00:00:00Z";
  if (kind === "duplicate_queue") d.queue.push(d.queue[0]);
  if (kind === "duplicate_detail") d.details.push(d.details[0]);
  if (kind === "duplicate_account") d.accounts.push(d.accounts[0]);
  if (kind === "trimmed_code") d.mapping.rows[0].barcode = " 000123";
  if (kind === "invented_delivery") d.details[0].delivery_status = "DELIVERED";
  if (kind === "stale_detail")
    d.details[0].captured_at = "2026-10-20T00:00:00Z";
  if (kind === "wrong_source_key") d.details[0].document_key = "0".repeat(64);
  expect(() => run(d)).toThrow();
});
it.each([
  ["wrong_folio", "DETAIL_FOLIO_INVALID"],
  ["wrong_pay_folio", "PAYMENT_FOLIO_MISMATCH"],
  ["wrong_link_folio", "LINKED_FOLIO_MISMATCH"],
  ["wrong_total", "PAYMENT_ARITHMETIC_MISMATCH"],
  ["wrong_linked_amount", "LINKED_ACTIVE_AMOUNT_MISMATCH"],
  ["wrong_payment_ref", "PAYMENT_BREAKDOWN_LINK_MISMATCH"],
  ["wrong_payment_amount", "PAYMENT_BREAKDOWN_LINK_MISMATCH"],
  ["unknown_code", "MAPPING_SCOPE_INCOMPLETE"],
])("quarantines %s and refuses staging rehearsal", (kind, code) => {
  const d = fixture(),
    x = d.details[0];
  if (kind === "wrong_folio")
    x.detail_text = x.detail_text.replace(/^VSM1/, "VSM2");
  if (kind === "wrong_pay_folio")
    x.payment_text = x.payment_text.replace("VSM 1", "VSM 2");
  if (kind === "wrong_link_folio")
    x.linked_text = x.linked_text.replace("VSM 1", "VSM 2");
  if (kind === "wrong_total")
    x.payment_text = x.payment_text.replace("Total $1,000.00", "Total $999.00");
  if (kind === "wrong_linked_amount")
    x.linked_text = x.linked_text.replace("$300.00", "$200.00");
  if (kind === "wrong_payment_ref")
    x.payment_text = x.payment_text.replace("Abono 1", "Abono 2");
  if (kind === "wrong_payment_amount")
    x.payment_text = x.payment_text.replace("$300.00 MXN", "$200.00 MXN");
  if (kind === "unknown_code") d.mapping.rows = [];
  const p = run(d);
  expect(p.issues[0].code).toBe(code);
  expect(p.lines).toHaveLength(0);
  expect(() => generalCreditDetailSQL(p)).toThrow();
});
it("holds ambiguous or unmapped barcodes without guessing identity", () => {
  for (const variants of [
    [],
    [variant, "33333333-3333-4333-8333-333333333333"],
  ]) {
    const d = fixture();
    d.mapping.rows[0].variants = variants;
    const p = run(d);
    expect(p.lines[0].variant_id).toBeNull();
    expect(p.summary.mapped_lines).toBe(0);
  }
});
it("keeps generic historical debt out of product mapping even when a barcode exists", () => {
  const d = fixture();
  d.details[0].detail_text = d.details[0].detail_text.replace(
    "MODELOT.M",
    "DEBE MERCANCIA",
  );
  const p = run(d);
  expect(p.lines[0].variant_id).toBeNull();
  expect(p.lines[0].holds).toContain("LEGACY_GENERIC_DEBT_LINE");
});
it("keeps changed amount and historical customer name as review, never authorizes import", () => {
  const d = fixture();
  d.queue[0].expected_balance_cents = 80000;
  d.details[0].detail_text = d.details[0].detail_text.replace(
    "Cliente ejemplo",
    "Nombre histórico",
  );
  const p = run(d);
  expect(p.documents[0].holds).toEqual([
    "HISTORICAL_CUSTOMER_NAME_DIFFERS",
    "AMOUNT_CHANGED_SINCE_BASELINE",
  ]);
  expect(p.documents[0].operational_import_allowed).toBe(false);
});
it("reads explicit zero active without inventing complete linked history", () => {
  const d = fixture(),
    x = d.details[0];
  x.detail_text = x.detail_text
    .replace("Documentos vinculados (1)", "")
    .replace("Saldo $700.00", "Saldo $1,000.00");
  x.linked_text = null;
  x.payment_text =
    "Forma de pago\nFolio\nVSM 1\nTotal $1,000.00 MXN\nAbono total: $0.00 MXN\nSaldo: $1,000.00";
  d.accounts[0].state = d.accounts[0].state.replace("$700.00", "$1,000.00");
  const p = run(d);
  expect(p.issues).toHaveLength(0);
  expect(p.documents[0].linked_history_complete).toBe(false);
  expect(p.summary.explicit_zero_active_documents).toBe(1);
});
it("does not call a missing document paid or zero", () => {
  const d = fixture();
  d.details = [];
  const p = run(d);
  expect(p.summary.missing_expected).toBe(1);
  expect(p.accounts[0].holds).toContain("ACCOUNT_DOCUMENT_BALANCE_MISMATCH");
  expect(() => generalCreditDetailSQL(p)).toThrow();
});
it("requires extra documents to be observed in the account", () => {
  const d = fixture();
  const extra = structuredClone(d.details[0]);
  extra.folio = "VSM2";
  extra.document_key = digest({
    tenant: "VSM",
    client_ref: ref,
    folio: "VSM2",
  });
  extra.detail_text = extra.detail_text
    .replace("VSM1", "VSM2")
    .replace("6ad51050b2f77f4eba62982d", "6ad51050b2f77f4eba62982e");
  extra.linked_text = extra.linked_text
    .replace("VSM 1", "VSM 2")
    .replace("Abono 1", "Abono 2");
  extra.payment_text = extra.payment_text
    .replace("VSM 1", "VSM 2")
    .replace("Abono 1", "Abono 2");
  d.details.push(extra);
  expect(run(d).issues[0].code).toBe("UNEXPECTED_DOCUMENT_NOT_IN_ACCOUNT");
  d.accounts[0].unexpected_folios = ["VSM2"];
  d.accounts[0].table_folios.push("VSM2");
  d.accounts[0].state = d.accounts[0].state.replace("$700.00", "$1,400.00");
  const p = run(d);
  expect(p.summary.additional_documents).toBe(1);
  expect(p.summary.accounts_reconciled).toBe(1);
});
it("preserves signed source discounts and surcharge without using them as costs", () => {
  const x = fixture().details[0].detail_text;
  const discounted = x.replace(
    "$1,000.00\n\n$1,000.00",
    "$1,000.00\n\n10% ($100.00)\n\n$900.00",
  );
  expect(creditDetailLines(discounted)[0]).toMatchObject({
    source_adjustment_cents: 10000,
    line_amount_cents: 90000,
  });
  const extra = x.replace(
    "$1,000.00\n\n$1,000.00",
    "$1,000.00\n\n-10% (-$100.00)\n\n$1,100.00",
  );
  expect(creditDetailLines(extra)[0].source_adjustment_cents).toBe(-10000);
  expect(() => creditDetailLines(x.replace("1 PZA", "1.5 PZA"))).toThrow(
    "UNSUPPORTED",
  );
});
it("rejects unsigned cancellation and keeps cancelled payment out of paid total", () => {
  const text = "10/21/2026 01:00:00 PM\nAbono 1 Cancelado\n-$300.00 MXN";
  expect(paymentBreakdownEntries(text)[0].cancelled).toBe(true);
  expect(() => paymentBreakdownEntries(text.replace("-$", "$"))).toThrow(
    "SIGN",
  );
  const d = fixture(),
    x = d.details[0];
  x.detail_text = x.detail_text.replace("(1)", "(2)");
  x.linked_text +=
    "\n10/21/2026 12:00:00 PM\nAbono 2\nCancelado 10/21/2026 12:01:00 PM\n$200.00 MXN";
  x.payment_text = x.payment_text.replace(
    "Total $1,000.00",
    "10/21/2026 12:00:00 PM\nAbono 2\n$200.00 MXN\n10/21/2026 12:01:00 PM\nAbono 2 Cancelado\n-$200.00 MXN\nTotal $1,000.00",
  );
  const p = run(d);
  expect(p.issues).toHaveLength(0);
  expect(p.summary.cancelled_amount_cents).toBe(20000);
  expect(p.summary.historical_active_paid_cents).toBe(30000);
});
it("generates only TEMP source reconciliation with rollback and no identities in SQL", () => {
  const sql = generalCreditDetailSQL(run(fixture()));
  expect(sql).toContain("app.assert_sicar_staging_enabled()");
  expect(sql).toContain("rollback;");
  expect(sql).toContain("INVENTED_RESERVATION_ACCEPTED");
  expect(sql).not.toContain("Cliente ejemplo");
  expect(sql).not.toMatch(/insert into (public|app)\./);
});
it("pins inputs, reproduces the exact plan, and rejects overwritten sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "m9-details-"));
  try {
    const d = fixture(),
      inputs = {};
    for (const name of ["queue", "accounts", "details", "mapping"]) {
      const raw = JSON.stringify(d[name]);
      writeFileSync(join(dir, name + ".json"), raw);
      inputs[name] = {
        path: name + ".json",
        sha256: createHash("sha256").update(raw).digest("hex"),
      };
    }
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ inputs, assessment_at: at }),
    );
    prepareGeneralCreditDetails(join(dir, "config.json"), join(dir, "one"));
    prepareGeneralCreditDetails(join(dir, "config.json"), join(dir, "two"));
    expect(readFileSync(join(dir, "one/sha256.json"), "utf8")).toBe(
      readFileSync(join(dir, "two/sha256.json"), "utf8"),
    );
    writeFileSync(join(dir, "details.json"), "[]");
    expect(() =>
      prepareGeneralCreditDetails(join(dir, "config.json"), join(dir, "three")),
    ).toThrow("INPUT_CHANGED:details");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("never trims or normalizes a source barcode to force a match", () => {
  const raw = fixture().details[0].detail_text.replace("000123", " 000123");
  expect(() => creditDetailLines(raw)).toThrow("ITEM_BLOCK_REQUIRED");
});
