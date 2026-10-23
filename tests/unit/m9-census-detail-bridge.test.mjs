import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { digest } from "../../scripts/m9/acceleration.mjs";
import { censusRenewalDelta } from "../../scripts/m9/prepare-general-customers.mjs";
import { creditDetailArchive } from "../../scripts/m9/archive-credit-details.mjs";
import {
  buildCensusDetailBridge,
  corroborateRenderedItemRoles,
  prepareCensusDetailBridge,
} from "../../scripts/m9/clientes-census-detail-bridge.mjs";
const at = "2026-10-23T14:00:00.000Z",
  before = "2026-10-21T12:00:00.000Z",
  archived = "2026-10-22T12:00:00.000Z",
  current = "2026-10-22T13:00:00.000Z",
  refreshed = "2026-10-23T12:00:00.000Z",
  hash = "a".repeat(64),
  project = "zsezjtswqeijboezvado",
  sha = (s) => createHash("sha256").update(s).digest("hex"),
  ref = (n) => `00000000-7777-4777-8777-${String(n).padStart(12, "0")}`,
  key = (n) => digest({ tenant: "VSM", client_ref: ref(n) }),
  docKey = (n, f) => digest({ tenant: "VSM", client_ref: ref(n), folio: f });
const doc = (n, f, total, balance) => ({
  key: docKey(n, f),
  folio: f,
  total_cents: total,
  balance_cents: balance,
});
function fixture() {
  const previous = {
    protocol: "m9-census-archive-1",
    source_plan_sha256: hash,
    source_at: before,
    observed_until: before,
    scope: "VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY",
    accounts: [
      {
        key: key(1),
        ref: ref(1),
        name: "QA same name",
        used_cents: 1000,
        source_at: before,
        documents: [doc(1, "F1", 1000, 1000)],
      },
      {
        key: key(2),
        ref: ref(2),
        name: "QA same name",
        used_cents: 500,
        source_at: before,
        documents: [doc(2, "F1", 1500, 500)],
      },
    ],
  };
  const now = {
    protocol: "m9-census-archive-renewal-1",
    source_plan_sha256: "b".repeat(64),
    source_at: current,
    observed_until: current,
    scope: previous.scope,
    archive_only: true,
    operational_import_allowed: false,
    expected_context: { prior_archive: { source_plan_sha256: hash } },
    accounts: [
      {
        ...previous.accounts[0],
        used_cents: 2000,
        source_at: current,
        documents: [doc(1, "F1", 1000, 1000), doc(1, "F2", 1000, 1000)],
      },
      {
        ...previous.accounts[1],
        used_cents: 0,
        source_at: current,
        documents: [],
      },
    ],
  };
  now.delta = censusRenewalDelta(previous, now.accounts);
  let id = 0;
  const details = now.accounts.map((a, i) => ({
    key: a.key,
    ref: a.ref,
    name: a.name,
    source_at: archived,
    balance_cents: a.used_cents,
    documents: (i === 0 ? a.documents : previous.accounts[1].documents).map(
      (d) => ({
        ...d,
        source_id: (++id).toString(16).padStart(24, "0"),
        source_at: archived,
        historical_name: a.name,
        balance_cents: i === 0 ? d.balance_cents : 0,
        paid_cents: i === 0 ? 0 : 1500,
        due_date: i === 0 ? "2026-11-01" : null,
        holds: [],
        linked_history_complete: i !== 0,
        evidence_sha256: hash,
        payments:
          i === 0
            ? []
            : [
                {
                  key: digest({ tenant: "VSM", source_ref: "Abono 1" }),
                  ref: "Abono 1",
                  occurred_label: "10/22/2026 06:00:00 AM",
                  amount_cents: 1500,
                  cancelled: false,
                  evidence_sha256: hash,
                },
              ],
        lines: [
          {
            index: 0,
            barcode: "000123",
            quantity: "1",
            description: "QA literal product",
            variant_id: null,
            holds: ["DELIVERY_NOT_OBSERVED", "BARCODE_NOT_IN_STAGING"],
            delivery_status: "UNKNOWN",
            reserved_qty: null,
            stock_deduction: null,
          },
        ],
      }),
    ),
  }));
  const archive = {
    protocol: "m9-credit-detail-archive-1",
    source_plan_sha256: "c".repeat(64),
    source_from: archived,
    source_until: archived,
    operational_import_allowed: false,
    accounts: details,
  };
  return { previous, current: now, archive, assessment_at: at };
}
const renew = (f) => {
  const a = structuredClone(f.archive);
  a.source_from = a.source_until = refreshed;
  for (const c of a.accounts) {
    c.source_at = refreshed;
    for (const d of c.documents) d.source_at = refreshed;
  }
  return a;
};
describe("census/detail documentary bridge without financial interpretation", () => {
  it("explains two old-to-new differences using archived detail, keeping later reading pending", () => {
    const f = fixture(),
      snapshot = JSON.stringify(f),
      p = buildCensusDetailBridge(f);
    expect(p.summary).toMatchObject({
      changed_accounts: 2,
      historical_evidence_aligned: 2,
      evidence_alignment_complete: 0,
      detail_documents_in_review: 3,
    });
    expect(
      p.accounts.every((a) =>
        a.holds.includes("NO_LATER_DETAIL_REOBSERVATION"),
      ),
    ).toBe(true);
    expect(
      p.accounts.find((a) => a.ref === ref(2)).documents[0]
        .current_open_balance_cents,
    ).toBeNull();
    expect(
      p.accounts.find((a) => a.ref === ref(2)).documents[0].archived_detail
        .balance_cents,
    ).toBe(0);
    expect(p.capture_queue[0].expected_source_document_id).toMatch(
      /^[a-f0-9]{24}$/,
    );
    expect(
      p.cash_replays +
        p.debt_closures +
        p.financial_openings +
        p.stock_movements,
    ).toBe(0);
    expect(JSON.stringify(f)).toBe(snapshot);
  });
  it("aligns a later exact reading only as evidence; preserves literal codes and UNKNOWN", () => {
    const f = fixture();
    f.renewed = renew(f);
    const p = buildCensusDetailBridge(f);
    expect(p.summary.evidence_alignment_complete).toBe(2);
    expect(
      p.accounts.every(
        (a) =>
          a.operational_import_allowed === false &&
          a.delivery_status === "UNKNOWN" &&
          a.close_operating_debt === false,
      ),
    ).toBe(true);
    expect(p.accounts[0].renewed_detail.documents[0].lines[0].barcode).toBe(
      "000123",
    );
    expect(
      p.accounts.find((a) => a.ref === ref(2)).renewed_detail.documents[0]
        .paid_cents,
    ).toBe(1500);
    expect(p.operational_import_allowed).toBe(false);
  });
  it("does not merge same names or same folio across UUIDs", () => {
    const p = buildCensusDetailBridge(fixture());
    expect(new Set(p.accounts.map((a) => a.key)).size).toBe(2);
    expect(new Set(p.capture_queue.map((d) => d.document_key)).size).toBe(3);
  });
  it("leaves an additional account outside the archived detail explicitly pending", () => {
    const f = fixture();
    f.current.accounts.push({
      key: key(3),
      ref: ref(3),
      name: "QA new",
      used_cents: 2400,
      source_at: current,
      documents: [doc(3, "F3", 2400, 2400)],
    });
    f.current.delta = censusRenewalDelta(f.previous, f.current.accounts);
    const p = buildCensusDetailBridge(f);
    expect(p.summary.additional_census_accounts_without_archived_detail).toBe(
      1,
    );
    expect(p.summary.additional_census_observed_cents).toBe(2400);
    expect(p.additional_unreviewed_keys).toEqual([key(3)]);
  });
  it.each([
    [
      (f) => f.archive.accounts[1].documents.splice(0),
      "ARCHIVED_DETAIL_DIFFERS_OR_INCOMPLETE",
    ],
    [
      (f) => {
        f.archive.accounts[0].source_at = before;
        f.archive.source_from = before;
      },
      "ARCHIVED_EVIDENCE_OUTSIDE_CENSUS_INTERVAL",
    ],
    [
      (f) => f.archive.accounts[0].documents[0].holds.push("SOURCE_ID_CHANGED"),
      "ARCHIVED_SOURCE_ID_REVIEW",
    ],
  ])("holds documentary gaps without inventing payments %#", (change, hold) => {
    const f = fixture();
    change(f);
    const p = buildCensusDetailBridge(f);
    expect(p.accounts.some((a) => a.holds.includes(hold))).toBe(true);
    expect(p.debt_closures).toBe(0);
  });
  it.each([
    [
      (f) => (f.renewed.accounts[0].documents[0].source_id = "f".repeat(24)),
      "REOBSERVED_DOCUMENT_IDENTITY_CHANGED",
    ],
    [
      (f) => (f.renewed.accounts[0].documents[0].lines[0].barcode = "00123"),
      "REOBSERVED_LINE_CONTENT_CHANGED",
    ],
    [
      (f) => {
        const a = f.renewed.accounts[0];
        a.source_at = current;
        a.documents[0].source_at = current;
        f.renewed.source_from = current;
      },
      "DETAIL_REOBSERVATION_NOT_AFTER_CENSUS",
    ],
    [
      (f) => {
        const d = f.renewed.accounts[1].documents[0];
        d.payments[0].ref = "Abono 2";
        d.payments[0].key = digest({ tenant: "VSM", source_ref: "Abono 2" });
      },
      "REOBSERVED_PAYMENT_HISTORY_CHANGED",
    ],
  ])("retains new changes instead of updating books %#", (change, hold) => {
    const f = fixture();
    f.renewed = renew(f);
    change(f);
    const p = buildCensusDetailBridge(f);
    expect(p.accounts.some((a) => a.holds.includes(hold))).toBe(true);
    expect(p.cash_replays).toBe(0);
  });
  it("excludes cancelled amounts from active paid evidence and detects cancellation drift", () => {
    const f = fixture(),
      d = f.archive.accounts[1].documents[0];
    d.payments.push({
      key: digest({ tenant: "VSM", source_ref: "Abono 2" }),
      ref: "Abono 2",
      occurred_label: "10/22/2026 07:00:00 AM",
      amount_cents: 500,
      cancelled: true,
      evidence_sha256: hash,
    });
    f.renewed = renew(f);
    expect(buildCensusDetailBridge(f).summary.evidence_alignment_complete).toBe(
      2,
    );
    f.renewed.accounts[1].documents[0].payments[1].cancelled = false;
    expect(() => buildCensusDetailBridge(f)).toThrow(
      "BRIDGE_ACTIVE_PAYMENTS_DIFFER",
    );
  });
  it.each([
    (f) => f.current.accounts[0].used_cents++,
    (f) => (f.current.accounts[0].documents[0].key = "f".repeat(64)),
    (f) => f.current.delta.balance_changed_keys.pop(),
    (f) =>
      (f.current.expected_context.prior_archive.source_plan_sha256 = "d".repeat(
        64,
      )),
    (f) => (f.current.source_at = "2026-02-31T00:00:00.000Z"),
    (f) => f.archive.accounts[1].documents[0].paid_cents++,
    (f) =>
      (f.archive.accounts[0].documents[0].lines[0].delivery_status =
        "DELIVERED"),
    (f) => (f.archive.accounts[0].documents[0].lines[0].reserved_qty = 0),
    (f) => (f.archive.accounts[0].documents[0].lines[0].barcode = "000\n123"),
    (f) => {
      f.renewed = renew(f);
      f.renewed.accounts.pop();
    },
  ])("rejects incoherent, ambiguous or operational input %#", (change) => {
    const f = fixture();
    change(f);
    expect(() => buildCensusDetailBridge(f)).toThrow();
  });
  it("reproduces pinned plans, verifies archived preimage/context and refuses overwrite", () => {
    const f = fixture(),
      dir = mkdtempSync(join(tmpdir(), "m9-credit-bridge-"));
    try {
      const accounts = f.archive.accounts.map((a) => ({
          client_ref: a.ref,
          name: a.name,
        })),
        raw = JSON.stringify(accounts),
        plan = {
          version: "m9-general-credit-details-1",
          project_id: project,
          production_allowed: false,
          operational_import_allowed: false,
          inventory_import_allowed: false,
          baseline_refreshed: false,
          simultaneous_closing_cut: false,
          source_from: archived,
          source_until: archived,
          inputs: { accounts: sha(raw) },
          issues: [],
          missing_expected: [],
          accounts: f.archive.accounts.map((a) => ({
            client_ref: a.ref,
            customer_key: a.key,
            source_at: a.source_at,
            used_cents: a.balance_cents,
            holds: [],
          })),
          documents: [],
          payments: [],
          lines: [],
        };
      for (const a of f.archive.accounts)
        for (const d of a.documents) {
          plan.documents.push({
            document_key: d.key,
            client_ref: a.ref,
            source_folio: d.folio,
            source_document_id: d.source_id,
            source_at: d.source_at,
            source_customer_name: d.historical_name,
            total_cents: d.total_cents,
            balance_cents: d.balance_cents,
            paid_to_date_cents: d.paid_cents,
            due_date: d.due_date,
            holds: d.holds,
            linked_history_complete: d.linked_history_complete,
            source_evidence_sha256: d.evidence_sha256,
          });
          plan.payments.push(
            ...d.payments.map((p) => ({
              ...p,
              document_key: d.key,
              payment_key: p.key,
              source_ref: p.ref,
            })),
          );
          plan.lines.push(
            ...d.lines.map((l) => ({
              ...l,
              document_key: d.key,
              line_index: l.index,
              source_description: l.description,
            })),
          );
        }
      f.archive = creditDetailArchive(
        plan,
        sha(JSON.stringify(plan)),
        accounts,
        sha(raw),
      );
      const data = {
          previous: f.previous,
          current: f.current,
          detail_plan: plan,
          detail_accounts: accounts,
          archive: f.archive,
          archive_context: {
            source_plan_sha256: f.archive.source_plan_sha256,
            payload_hash: hash,
            actual_payload_hash: hash,
            source_from: archived,
            source_until: archived,
            accounts: 2,
            documents: 3,
          },
        },
        inputs = {};
      for (const [n, v] of Object.entries(data)) {
        const path = join(dir, n + ".json"),
          content = JSON.stringify(v);
        writeFileSync(path, content);
        inputs[n] = { path, sha256: sha(content) };
      }
      const config = join(dir, "config.json");
      writeFileSync(
        config,
        JSON.stringify({
          project_id: project,
          mode: "READ_ONLY_EVIDENCE_BRIDGE",
          assessment_at: at,
          inputs,
        }),
      );
      prepareCensusDetailBridge(config, join(dir, "one"));
      prepareCensusDetailBridge(config, join(dir, "two"));
      for (const name of [
        "puente-privado.json",
        "resumen.json",
        "cola-detalles.json",
        "sha256.json",
      ])
        expect(readFileSync(join(dir, "one", name), "utf8")).toBe(
          readFileSync(join(dir, "two", name), "utf8"),
        );
      expect(() =>
        prepareCensusDetailBridge(config, join(dir, "one")),
      ).toThrow();
      writeFileSync(inputs.archive.path, "{}");
      expect(() =>
        prepareCensusDetailBridge(config, join(dir, "changed")),
      ).toThrow("BRIDGE_INPUT_CHANGED:archive");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function roleFixture(barcode = "000123") {
  const source = "0".repeat(23) + "1",
    text = `F1\nCód Doc. ${source}\nAlmacén:\n\nDEFAULT\n\nCantidad\n\nDescripción\n\nPrecio\n\nImporte\n\n1 PZA\n\nBC\n\n${barcode}\n\nMODEL\n\n$10.00\n\n$10.00\n\nFormas de Pago/Abonos\nMXN $10.00`;
  const detail = {
    client_ref: ref(1),
    folio: "F1",
    detail_text: text,
    captured_at: "2026-10-23T10:00:00.000Z",
    full_reload_before_read: true,
    delivery_status: "UNKNOWN",
  };
  const proof = {
    client_ref: ref(1),
    folio: "F1",
    captured_at: "2026-10-23T11:00:00.000Z",
    purpose: "RENDERED_ROLE_EXTRACTION_SUPPORT_ONLY",
    source_read_only: true,
    ax_snapshot: `  - paragraph: Cód Doc. ${source}\n  - paragraph: Cantidad\n  - paragraph: Descripción\n  - paragraph: Precio\n  - paragraph: Importe\n  - paragraph: 1 PZA\n  - generic: BC\n  - paragraph: "${barcode}"\n  - paragraph: MODEL\n  - paragraph: $10.00\n  - paragraph: $10.00\n  - button "Formas de Pago/Abonos": Formas de Pago/Abonos`,
    paragraph_nodes: ["1 PZA", barcode, "MODEL", "$10.00", "$10.00"],
    rendered_detail_text: text,
  };
  return { detail, proof };
}
describe("independent rendered-role corroboration without guessing barcodes", () => {
  it.each(["000123", "BC"])(
    "removes only the observed generic and preserves literal barcode %s",
    (barcode) => {
      const { detail, proof } = roleFixture(barcode),
        before = JSON.stringify(detail),
        result = corroborateRenderedItemRoles(detail, proof, at, ["BC"]);
      expect(result.captured_at).toBe(detail.captured_at);
      expect(result.full_reload_before_read).toBe(true);
      expect(result.item_role_corroboration.captured_at).toBe(
        proof.captured_at,
      );
      expect(result.item_role_corroboration.source_capture_refreshed).toBe(
        false,
      );
      expect(result.detail_text).toContain("1 PZA\n\n\n" + barcode);
      expect(JSON.stringify(detail)).toBe(before);
    },
  );
  it("requires explicit reviewed markers rather than treating any generic as decorative", () => {
    const { detail, proof } = roleFixture();
    expect(() =>
      corroborateRenderedItemRoles(detail, proof, at, undefined),
    ).toThrow("BRIDGE_ITEM_EXPLICIT_MARKER_APPROVAL_REQUIRED");
    expect(() =>
      corroborateRenderedItemRoles(detail, proof, at, ["OTHER"]),
    ).toThrow("BRIDGE_ITEM_GENERIC_POSITION_UNPROVEN");
  });
  it.each(["barcode", "description", "quantity", "whole_item"])(
    "never drops substantive generic %s content",
    (kind) => {
      const { detail, proof } = roleFixture();
      // The raw text remains the same; role changes alone must not erase data.
      if (kind === "barcode")
        proof.ax_snapshot = proof.ax_snapshot.replace(
          'paragraph: "000123"',
          "generic: 000123",
        );
      if (kind === "description")
        proof.ax_snapshot = proof.ax_snapshot.replace(
          "paragraph: MODEL",
          "generic: MODEL",
        );
      if (kind === "quantity")
        proof.ax_snapshot = proof.ax_snapshot.replace(
          "paragraph: 1 PZA",
          "generic: 1 PZA",
        );
      if (kind === "whole_item")
        proof.ax_snapshot = proof.ax_snapshot
          .replace("paragraph: 1 PZA", "generic: 1 PZA")
          .replace('paragraph: "000123"', "generic: 000123")
          .replace("paragraph: MODEL", "generic: MODEL")
          .replaceAll("paragraph: $10.00", "generic: $10.00");
      expect(() =>
        corroborateRenderedItemRoles(detail, proof, at, ["BC"]),
      ).toThrow();
    },
  );
  it.each([
    "source_id",
    "render_price",
    "ax_barcode",
    "missing_dom",
    "not_generic",
    "not_reload",
    "future_proof",
  ])("rejects uncorroborated role evidence %s", (kind) => {
    const { detail, proof } = roleFixture();
    if (kind === "source_id")
      proof.ax_snapshot = proof.ax_snapshot.replace(
        "0".repeat(23) + "1",
        "f".repeat(24),
      );
    if (kind === "render_price")
      proof.rendered_detail_text = proof.rendered_detail_text.replace(
        "$10.00",
        "$11.00",
      );
    if (kind === "ax_barcode")
      proof.ax_snapshot = proof.ax_snapshot.replace("000123", "000124");
    if (kind === "missing_dom") proof.paragraph_nodes = [];
    if (kind === "not_generic")
      proof.ax_snapshot = proof.ax_snapshot.replace(
        "generic: BC",
        "paragraph: BC",
      );
    if (kind === "not_reload") detail.full_reload_before_read = false;
    if (kind === "future_proof") proof.captured_at = "2026-10-24T11:00:00.000Z";
    expect(() =>
      corroborateRenderedItemRoles(detail, proof, at, ["BC"]),
    ).toThrow();
  });
});
