import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  customerCreditPlan,
  customerCreditRehearsalSQL,
  mxnCents,
  phoneCandidate,
  sourceDate,
  parseLinkedAbonos,
  prepareCustomerCredit,
} from "../../scripts/m9/prepare-customer-credit.mjs";
import { customerCreditNativeRehearsal } from "../../scripts/m9/customer-credit-native-rehearsal.mjs";
const at = "2026-10-20T16:00:00Z";
function fixture() {
  const c = {
    client_ref: "source-one",
    list_index: 0,
    source_display_name: "Cliente de origen <script>",
    phone_label: "Celular+52 3521234567;",
    email_label: null,
    privacy_consent: null,
    marketing_consent: null,
    captured_at: at,
    credit_summary_text: "Saldo utilizado\n$700.00\nSaldo vencido\n$0.00",
    unpaid_rows: [{ folio: "VSM1", row_text: "VSM1\n$1,000.00 MXN\n$700.00" }],
    paid_rows: [{ folio: "1072", row_text: "1072\nPagado\n$50.00 MXN\n$0.00" }],
  };
  const d = {
    client_ref: c.client_ref,
    folio: "VSM1",
    financial_status: "OPEN",
    delivery_status: "UNKNOWN",
    captured_at: at,
    lines: [{ line_index: 0, barcode: "000012", quantity: "1" }],
  };
  return {
    clients: [c],
    accounts: [
      {
        client_ref: c.client_ref,
        list_index: 0,
        unpaid: { folios: ["VSM1"] },
        paid: { folios: ["1072"] },
      },
    ],
    documents: [d, { ...d, folio: "1072", financial_status: "PAID" }],
    details: [
      {
        client_ref: c.client_ref,
        folio: "VSM1",
        captured_at: at,
        detail_text:
          "VSM1\nCód Doc. 6ad51050b2f77f4eba62982d\nDocumentos vinculados (2)\nSaldo $700.00\nVence el 11/17/2026\nMXN $1,000.00",
        linked_text:
          "Documentos vinculados - Venta VSM 1\n10/18/2026 12:30:58 PM\nAbono 1381\nCliente de origen\n$300.00 MXN\n10/18/2026 12:29:58 PM\nAbono 1380\nCancelado 10/18/2026 12:30:00 PM\nCliente de origen\n$300.00 MXN",
      },
    ],
    scope: {
      search: "APARTADO",
      receipt_filter: "Todos",
      unlabelled_customers_reviewed: false,
      terminal_page_observed: true,
      terminal_list_count: 1,
      captured_at: at,
    },
    mapping: {
      project_id: "zsezjtswqeijboezvado",
      captured_at: at,
      rows: [
        {
          barcode: "000012",
          variants: ["6da4feb2-7146-4d4d-b865-6af14cc02a9b"],
        },
      ],
    },
  };
}
it("parses integer cents, rejects missing decimals, malformed thousands and excessive sums", () => {
  expect(mxnCents("$11,910.00")).toBe(1191000);
  for (const m of [
    "11910",
    "$11910.00",
    "$1,19.00",
    "$01.00",
    "$-1.00",
    "$0.001",
    "$9,999,999,999,999,999.00",
    null,
  ])
    expect(() => mxnCents(m)).toThrow();
});
it("conservatively normalizes only the observed phone label and does not invent or guess contacts", () => {
  expect(phoneCandidate("Celular+52 3521234567;")).toBe("+523521234567");
  expect(phoneCandidate(null)).toBe(null);
  for (const p of [
    "Celular+5213521234567;",
    "Celular3521234567;",
    "Celular+52 3521234567 extension 5;",
  ])
    expect(phoneCandidate(p)).toBe(null);
});
it("validates calendar dates in the observed MM/DD/YYYY convention", () => {
  expect(sourceDate("11/17/2026")).toBe("2026-11-17");
  for (const d of ["17/11/2026", "02/30/2026", null])
    expect(() => sourceDate(d)).toThrow();
});
it("reconciles cancellations without charging or replaying historical payments", () => {
  const p = customerCreditPlan(fixture(), at);
  expect(p.summary).toMatchObject({
    customers: 1,
    documents: 2,
    open_documents: 1,
    paid_documents: 1,
    opening_candidate_cents: 70000,
    linked_payments: 2,
    cancelled_payments: 1,
    active_historical_payments_cents: 30000,
    unknown_deliveries: 2,
  });
  expect(p.payments.every((x) => x.replay_as_cash === false)).toBe(true);
  expect(p.documents.find((d) => d.financial_status === "PAID")).toMatchObject({
    balance_cents: 0,
    payment_evidence: "NOT_CAPTURED_ARCHIVE_ONLY",
  });
  expect(
    p.lines.every(
      (l) =>
        l.barcode === "000012" &&
        l.reserved_qty === null &&
        l.additional_stock_deduction === null,
    ),
  ).toBe(true);
  expect(p.customers[0]).toMatchObject({
    target_customer_id: null,
    privacy_consent_at: null,
    auth_user_id: null,
    operational_import_allowed: false,
  });
});
it("rejects an active duplicate payment, a cancelled payment included as paid, or missing detail", () => {
  const f = fixture();
  f.details[0].linked_text = f.details[0].linked_text.replace(
    "Cancelado 10/18/2026 12:30:00 PM",
    "",
  );
  expect(() => customerCreditPlan(f, at)).toThrow(
    "ACTIVE_ABONOS_DO_NOT_RECONCILE",
  );
  const g = fixture();
  g.details[0].linked_text = g.details[0].linked_text.replace(
    "Abono 1380",
    "Abono 1381",
  );
  expect(() => parseLinkedAbonos(g.details[0])).toThrow(
    "DUPLICATE_SOURCE_PAYMENT",
  );
  const h = fixture();
  h.details = [];
  expect(() => customerCreditPlan(h, at)).toThrow(
    "OPEN_DOCUMENT_DETAIL_REQUIRED",
  );
});
it("rejects incomplete linked capture or a changed financial total", () => {
  const f = fixture();
  f.details[0].detail_text = f.details[0].detail_text.replace(
    "vinculados (2)",
    "vinculados (3)",
  );
  expect(() => customerCreditPlan(f, at)).toThrow(
    "LINKED_PAYMENT_COUNT_MISMATCH",
  );
  const g = fixture();
  g.details[0].detail_text = g.details[0].detail_text.replace(
    "MXN $1,000.00",
    "MXN $999.00",
  );
  expect(() => customerCreditPlan(g, at)).toThrow("DETAIL_MONEY_MISMATCH");
});
it("rejects a customer balance gap, reopened paid debt or mismatched document state", () => {
  const f = fixture();
  f.clients[0].credit_summary_text = f.clients[0].credit_summary_text.replace(
    "$700.00",
    "$701.00",
  );
  expect(() => customerCreditPlan(f, at)).toThrow("CUSTOMER_BALANCE_MISMATCH");
  const g = fixture();
  g.clients[0].paid_rows[0].row_text = "Pagado\n$50.00 MXN\n$1.00";
  expect(() => customerCreditPlan(g, at)).toThrow(
    "INVALID_DOCUMENT_MONEY_OR_STATUS",
  );
  const h = fixture();
  h.documents[0].financial_status = "PAID";
  expect(() => customerCreditPlan(h, at)).toThrow("EXACT_DOCUMENT_REQUIRED");
});
it("keeps missing and ambiguous variants on hold without name matching", () => {
  for (const variants of [
    [],
    [
      "6da4feb2-7146-4d4d-b865-6af14cc02a9b",
      "d64b4861-b3f1-44e3-acf5-ba517d09681a",
    ],
  ]) {
    const f = fixture();
    f.mapping.rows[0].variants = variants;
    const p = customerCreditPlan(f, at);
    expect(p.summary.mapped_lines).toBe(0);
    expect(p.lines[0].holds).toContain("VARIANT_MAPPING_REVIEW");
  }
  const f = fixture();
  f.mapping.rows[0].barcode = "12";
  expect(() => customerCreditPlan(f, at)).toThrow("MAPPING_SCOPE_INCOMPLETE");
});
it("does not invent privacy consent or process unbounded/stale source data", () => {
  const f = fixture();
  f.clients[0].privacy_consent = true;
  expect(() => customerCreditPlan(f, at)).toThrow(
    "EXACT_CUSTOMER_EVIDENCE_REQUIRED",
  );
  const g = fixture();
  g.scope.unlabelled_customers_reviewed = true;
  expect(() => customerCreditPlan(g, at)).toThrow(
    "BOUNDED_CUSTOMER_SCOPE_REQUIRED",
  );
  expect(() => customerCreditPlan(fixture(), "2026-10-22T16:00:00Z")).toThrow(
    "BOUNDED_CUSTOMER_SCOPE_REQUIRED",
  );
  const h = fixture();
  h.mapping.project_id = "production";
  expect(() => customerCreditPlan(h, at)).toThrow("STAGING_MAPPING_REQUIRED");
});
it("keeps two similar names and shared phones as separate source identities", () => {
  const f = fixture();
  const extra = {
    ...structuredClone(f.clients[0]),
    client_ref: "source-two",
    list_index: 1,
    unpaid_rows: [],
    paid_rows: [],
    credit_summary_text: "Saldo utilizado\n$0.00\nSaldo vencido\n$0.00",
  };
  f.clients.push(extra);
  f.accounts.push({
    client_ref: extra.client_ref,
    list_index: 1,
    unpaid: { folios: [] },
    paid: { folios: [] },
  });
  f.scope.terminal_list_count = 2;
  const p = customerCreditPlan(f, at);
  expect(p.customers).toHaveLength(2);
  expect(p.customers[0].customer_key).not.toBe(p.customers[1].customer_key);
  expect(p.summary).toMatchObject({
    shared_phone_customers: 2,
    duplicate_name_customers: 2,
  });
  expect(p.customers.every((c) => c.target_customer_id === null)).toBe(true);
});
it("makes stable identity/document keys while retaining raw contacts privately", () => {
  const f = fixture();
  const p = customerCreditPlan(f, at);
  f.clients[0].source_display_name = "Nombre corregido";
  f.clients[0].phone_label = null;
  const q = customerCreditPlan(f, at);
  expect(q.documents[0].document_key).toBe(p.documents[0].document_key);
  expect(q.customers[0].customer_key).toBe(p.customers[0].customer_key);
  expect(q.customers[0].holds).toContain("CONTACT_MISSING");
});
it("generates a rollback-only pseudonymized rehearsal with FK and conflict tests", () => {
  const sql = customerCreditRehearsalSQL(customerCreditPlan(fixture(), at));
  expect(sql.trim().endsWith("rollback;")).toBe(true);
  expect(sql).toContain("app.assert_sicar_staging_enabled()");
  expect(sql).toContain("foreign_key_violation");
  expect(sql).toContain("not_null_violation");
  expect(sql).not.toContain("Cliente de origen");
  expect(sql).not.toContain("3521234567");
  expect(sql).not.toContain("insert into public.");
  expect(sql).not.toMatch(/\bcommit\s*;/i);
});
it("pins every input, reproduces identical output, and refuses overwrites or drift", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m9-client-test-"));
  try {
    const f = fixture(),
      inputs = {};
    for (const [name, data] of Object.entries(f)) {
      const raw = JSON.stringify(data);
      await writeFile(join(dir, name + ".json"), raw);
      inputs[name] = {
        path: name + ".json",
        sha256: createHash("sha256").update(raw).digest("hex"),
      };
    }
    const cfg = join(dir, "config.json");
    await writeFile(cfg, JSON.stringify({ assessment_at: at, inputs }));
    await prepareCustomerCredit(cfg, join(dir, "one"));
    await prepareCustomerCredit(cfg, join(dir, "two"));
    expect(await readFile(join(dir, "one", "sha256.json"), "utf8")).toBe(
      await readFile(join(dir, "two", "sha256.json"), "utf8"),
    );
    const html = await readFile(join(dir, "one", "reporte.html"), "utf8");
    expect(html).not.toContain("Cliente de origen");
    expect(html).not.toContain("source-one");
    expect(html).toContain("no todo el padrón");
    await expect(
      prepareCustomerCredit(cfg, join(dir, "one")),
    ).rejects.toThrow();
    await writeFile(join(dir, "clients.json"), "[]");
    await expect(
      prepareCustomerCredit(cfg, join(dir, "three")),
    ).rejects.toThrow("CUSTOMER_INPUT_CHANGED:clients");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("refuses native QA without a complete staging baseline", () => {
  expect(() =>
    customerCreditNativeRehearsal({ project_id: "production", audit: {} }),
  ).toThrow("FULL_STAGING_BASELINE_REQUIRED");
});

function nativeSnapshot() {
  const names = [
    "customers",
    "customer_credit_ledger",
    "customer_credit_allocations",
    "customer_credit_payments",
    "customer_credit_payment_parts",
    "sales",
    "inventory_movements",
    "cash_movements",
    "folios",
    "audit_log",
  ];
  const audit = Object.fromEntries(
    names.map((n) => ["public." + n, { count: 0, md5: "0".repeat(32) }]),
  );
  for (let i = 0; i < 110; i++)
    audit["app.m9_fixture_" + i] = { count: 0, md5: "0".repeat(32) };
  return { project_id: "zsezjtswqeijboezvado", captured_at: at, audit };
}
it("pins 120 fingerprints and keeps native QA constrained, synthetic and rollback-only", () => {
  const sql = customerCreditNativeRehearsal(nativeSnapshot());
  expect(sql).toContain("security invoker set search_path=''");
  expect(sql).toContain("revoke all on function pg_temp.m9_qa_opening");
  expect(sql).toContain("LEGACY_CREDIT_OPENING_QA");
  expect(sql).toContain("public.record_customer_credit_payment");
  expect(sql).toContain("app.credit_charge_outstanding");
  expect(sql).toContain("real_sicar_identity_mapping',false");
  expect(sql).toContain("EMPTY_CUSTOMER_LEDGER_REQUIRED");
  expect(sql).toContain("CREDIT_OVERPAYMENT");
  expect(sql.trim().endsWith("rollback;")).toBe(true);
  expect(sql).not.toMatch(
    /\bcommit\s*;|create_sale\(|insert into public\.customers|disable trigger|alter table/i,
  );
});
it("rejects unsafe audit identifiers and malformed fingerprints before building SQL", () => {
  const a = nativeSnapshot();
  delete a.audit["app.m9_fixture_0"];
  a.audit["app.m9_fixture_0;drop"] = { count: 0, md5: "0".repeat(32) };
  expect(() => customerCreditNativeRehearsal(a)).toThrow("UNSAFE_AUDIT_TABLE");
  const b = nativeSnapshot();
  b.audit["app.m9_fixture_0"].md5 = "invalid";
  expect(() => customerCreditNativeRehearsal(b)).toThrow(
    "INVALID_AUDIT_FINGERPRINT",
  );
  const c = nativeSnapshot();
  c.audit["app.m9_fixture_0"].count = -1;
  expect(() => customerCreditNativeRehearsal(c)).toThrow(
    "INVALID_AUDIT_FINGERPRINT",
  );
});
