import { describe, expect, it } from "vitest";
import {
  paymentDocumentSha256,
  reviewWooPaymentCandidate,
} from "../../scripts/m9/woo-payment-eligibility.mjs";
import { WOO_PILOT_ORIGIN } from "../../scripts/m9/woo-order-protocol.mjs";

import { paymentReviewFixture } from "../../scripts/m9/woo-payment-fixtures.mjs";
const variant = "00000000-0000-4000-8000-000000000001";
const variant2 = "00000000-0000-4000-8000-000000000002";
const orderHash = (s) => {
  const { observed_at: ignored, ...body } = s;
  void ignored;
  return paymentDocumentSha256(body);
};
function changeOrders(i, mutate) {
  mutate(i.first);
  mutate(i.second);
  i.evidence.order_sha256 = orderHash(i.second);
  i.evidence.amount = i.second.money.total;
  return i;
}
function entry(i, report, extra = {}) {
  return {
    provider: i.evidence.provider,
    account_id: i.evidence.account_id,
    merchant_id: i.evidence.merchant_id,
    origin: i.evidence.origin,
    currency: i.evidence.currency,
    reference: i.evidence.reference,
    action: i.evidence.action,
    order_id: i.evidence.order_id,
    commercial_sha256: report.commercial_sha256,
    order_sha256: report.order_sha256,
    source_sha256: i.evidence.source_sha256,
    amount: i.evidence.amount,
    operation_id: "qa-operation-1",
    result_sha256: "b".repeat(64),
    ...extra,
  };
}
function refundFixture() {
  const i = paymentReviewFixture(),
    paid = reviewWooPaymentCandidate(i);
  i.ledger.entries.push(entry(i, paid));
  changeOrders(i, (s) => {
    s.status = "refunded";
    s.payment.is_paid = false;
    s.money.refunded_total = "200.00";
    s.refund_lines.push({
      id: 9000009004,
      reference: "qa_refund_1",
      amount: "200.00",
      currency: "MXN",
    });
  });
  Object.assign(i.evidence, {
    action: "FULL_CANCEL",
    parent_reference: "qa_capture_1",
    reference: "qa_refund_1",
    state: "REFUNDED",
  });
  i.physical_receipt = {
    mode: "SANDBOX_TEST_ONLY",
    origin: WOO_PILOT_ORIGIN,
    order_id: i.second.order_id,
    reference: "qa-receiving-1",
    received_at: "2026-10-22T20:59:03.000Z",
    lines: [
      { line_id: 101, variant_id: variant, barcode: "000236", quantity: 2 },
    ],
  };
  return i;
}
const held = (i, reason) => {
  const result = reviewWooPaymentCandidate(i);
  expect(result.disposition).toBe("HOLD");
  expect(result.reasons).toContain(reason);
  expect(result.can_record_sale).toBe(false);
  expect(result.can_issue_sale_ticket).toBe(false);
  expect(result.stock_write_allowed).toBe(false);
  expect(result.database_command).toBe(null);
};

describe("sandbox payment eligibility is an offline review, never payment authority", () => {
  it("reconciles full-price identity and amount without inventing authentication", () => {
    const result = reviewWooPaymentCandidate(paymentReviewFixture());
    expect(result.disposition).toBe("REHEARSAL_CANDIDATE");
    expect(result.components_cents.total).toBe(20000);
    expect(result.source_documents_authenticated).toBe(false);
    expect(result.authenticated_provider_adapter_installed).toBe(false);
    expect(result.synthetic_sql_evidence_allowed).toBe(false);
    expect(result.requires_authenticated_readback).toBe(true);
    expect(result.stock_write_allowed).toBe(false);
    expect(result.database_command).toBe(null);
  });
  it("is deterministic, does not mutate input and does not turn own hashes into authentication", () => {
    const i = paymentReviewFixture(),
      copy = structuredClone(i);
    expect(reviewWooPaymentCandidate(i)).toEqual(
      reviewWooPaymentCandidate(copy),
    );
    expect(i).toEqual(copy);
    expect(paymentDocumentSha256({ z: 1, a: { b: 2, a: 1 } })).toBe(
      paymentDocumentSha256({ a: { a: 1, b: 2 }, z: 1 }),
    );
  });
  it("keeps Clave 1 literal including leading zeroes", () => {
    const i = paymentReviewFixture();
    i.reservation.lines[0].barcode = "236";
    held(i, "PAYMENT_RESERVATION_IDENTITY_CHANGED");
  });
  for (const [path, value, reason] of [
    [
      ["policy", "project"],
      "drubkjlmfbdeglucakmg",
      "PAYMENT_STAGING_SANDBOX_REQUIRED",
    ],
    [
      ["policy", "origin"],
      "https://vaquerosm.com",
      "PAYMENT_STAGING_SANDBOX_REQUIRED",
    ],
    [["policy", "mode"], "LIVE", "PAYMENT_STAGING_SANDBOX_REQUIRED"],
    [["evidence", "live_mode"], true, "PAYMENT_SANDBOX_PROOF_REQUIRED"],
    [["evidence", "mode"], "TEST", "PAYMENT_SANDBOX_PROOF_REQUIRED"],
    [["evidence", "provider"], "unknown", "PAYMENT_PROVIDER_IDENTITY_CHANGED"],
    [
      ["evidence", "merchant_id"],
      "another",
      "PAYMENT_PROVIDER_IDENTITY_CHANGED",
    ],
    [
      ["evidence", "account_id"],
      "another",
      "PAYMENT_PROVIDER_IDENTITY_CHANGED",
    ],
    [
      ["evidence", "origin"],
      "https://vaquerosm.com",
      "PAYMENT_PROVIDER_IDENTITY_CHANGED",
    ],
    [["evidence", "order_id"], 1, "PAYMENT_PROVIDER_ORDER_CHANGED"],
    [["evidence", "currency"], "USD", "PAYMENT_PROVIDER_ORDER_CHANGED"],
    [
      ["evidence", "order_sha256"],
      "c".repeat(64),
      "PAYMENT_ORDER_CHANGED_AFTER_CAPTURE",
    ],
    [["evidence", "source_sha256"], null, "PAYMENT_SOURCE_HASH_REQUIRED"],
    [["evidence", "state"], "AUTHORIZED", "PAYMENT_CAPTURE_REQUIRED"],
    [["evidence", "reference"], "", "PAYMENT_REFERENCE_REQUIRED"],
    [["evidence", "amount"], "199.99", "PAYMENT_CAPTURE_AMOUNT_DIFFERS"],
    [["evidence", "amount"], "201.00", "PAYMENT_CAPTURE_AMOUNT_DIFFERS"],
    [
      ["evidence", "observed_at"],
      "2026-10-22T20:50:00.000Z",
      "PAYMENT_EVIDENCE_NOT_RECENT",
    ],
    [
      ["evidence", "observed_at"],
      "2026-10-22T21:00:06.000Z",
      "PAYMENT_EVIDENCE_NOT_RECENT",
    ],
    [
      ["evidence", "observed_at"],
      "2026-10-22T20:59:00.000Z",
      "PAYMENT_PROVIDER_READ_BEFORE_ORDER_READ",
    ],
    [
      ["evidence", "occurred_at"],
      "2026-10-22T21:00:00.000Z",
      "PAYMENT_PROVIDER_TIME_INCONSISTENT",
    ],
    [["evidence", "action"], "PARTIAL_REFUND", "PAYMENT_ACTION_UNSUPPORTED"],
    [["reservation", "order_id"], 12, "PAYMENT_RESERVATION_ORDER_CHANGED"],
    [
      ["reservation", "expected_version"],
      1.5,
      "PAYMENT_RESERVATION_VERSION_INVALID",
    ],
    [
      ["reservation", "lines", 0, "barcode"],
      236,
      "PAYMENT_LITERAL_BARCODE_REQUIRED",
    ],
    [
      ["reservation", "lines", 0, "quantity"],
      1.5,
      "PAYMENT_WHOLE_QUANTITY_REQUIRED",
    ],
    [
      ["reservation", "lines", 0, "unit_price_cents"],
      9999,
      "PAYMENT_PUBLIC_PRICE_CHANGED",
    ],
    [["ledger", "complete"], false, "PAYMENT_REFERENCE_LEDGER_INCOMPLETE"],
    [["physical_receipt"], {}, "PAYMENT_UNEXPECTED_PHYSICAL_RECEIPT"],
    [["now"], "2026-02-30T21:00:00.000Z", "PAYMENT_EXPLICIT_CLOCK_REQUIRED"],
  ])
    it(`holds ${path.join(".")}=${String(value)}`, () => {
      const i = paymentReviewFixture();
      let v = i;
      for (const k of path.slice(0, -1)) v = v[k];
      v[path.at(-1)] = value;
      held(i, reason);
    });
  for (const method of [
    "CASH",
    "CARD",
    "TRANSFER",
    "cod",
    "bacs",
    "cheque",
    "M9_WEB_TEST",
    "m9_synthetic_no_payment",
  ])
    it(`does not masquerade ${method} as provider settlement`, () => {
      const i = paymentReviewFixture();
      i.policy.payment_method = method;
      held(i, "PAYMENT_NON_GATEWAY_METHOD_FORBIDDEN");
    });
  for (const [label, mutate, reason] of [
    [
      "extra buyer data",
      (i) => {
        i.first.email = "forbidden@example.invalid";
      },
      "PAYMENT_ORDER_SHAPE_INVALID",
    ],
    [
      "unknown money",
      (i) => {
        delete i.second.money.shipping_tax;
      },
      "PAYMENT_COMPONENTS_REQUIRED",
    ],
    [
      "changed second read",
      (i) => {
        i.second.status = "completed";
      },
      "PAYMENT_ORDER_NOT_STABLE",
    ],
    [
      "time goes backwards",
      (i) => {
        i.second.observed_at = "2026-10-22T20:58:59.000Z";
      },
      "PAYMENT_ORDER_NOT_STABLE",
    ],
    [
      "dated but unpaid",
      (i) =>
        changeOrders(i, (s) => {
          s.payment.is_paid = false;
        }),
      "PAYMENT_ORDER_HINTS_INCONSISTENT",
    ],
    [
      "status and reference but no date",
      (i) =>
        changeOrders(i, (s) => {
          s.payment.paid_at = null;
        }),
      "PAYMENT_ORDER_HINTS_INCONSISTENT",
    ],
    [
      "paid hints but no provider",
      (i) => {
        i.evidence = null;
      },
      "PAYMENT_PROVIDER_EVIDENCE_REQUIRED",
    ],
    [
      "provider but cancelled order",
      (i) =>
        changeOrders(i, (s) => {
          s.status = "cancelled";
        }),
      "PAYMENT_ORDER_HINTS_INCONSISTENT",
    ],
    [
      "provider reference differs",
      (i) =>
        changeOrders(i, (s) => {
          s.payment.transaction_id = "other";
        }),
      "PAYMENT_ORDER_HINTS_INCONSISTENT",
    ],
    [
      "provider method differs",
      (i) =>
        changeOrders(i, (s) => {
          s.payment.method = "other";
        }),
      "PAYMENT_ORDER_HINTS_INCONSISTENT",
    ],
    [
      "duplicate lines",
      (i) => {
        i.first.lines.push(i.first.lines[0]);
      },
      "PAYMENT_DUPLICATE_LINE",
    ],
    [
      "unsafe numeric identity",
      (i) => {
        i.first.lines[0].product_id = Number.MAX_SAFE_INTEGER + 1;
      },
      "PAYMENT_PRODUCT_ID_INVALID",
    ],
    [
      "overflow multiplication",
      (i) => {
        i.reservation.lines[0].unit_price_cents = Number.MAX_SAFE_INTEGER;
      },
      "PAYMENT_MONEY_OVERFLOW",
    ],
    [
      "extra ledger claims",
      (i) => {
        i.ledger.authenticated = true;
      },
      "PAYMENT_REFERENCE_LEDGER_REQUIRED",
    ],
  ])
    it(`holds ${label}`, () => {
      const i = paymentReviewFixture();
      mutate(i);
      held(i, reason);
    });
  for (const amount of [
    200,
    "200",
    "200.0",
    "0200.00",
    "200.000",
    "1e2",
    "-0.01",
    "NaN",
    " 200.00",
    "200.00 ",
  ])
    it(`rejects noncanonical amount ${amount}`, () => {
      const i = paymentReviewFixture();
      i.evidence.amount = amount;
      held(i, "FINANCE_DECIMAL_INVALID");
    });
  it("reconciles but holds all nonzero commercial components without dropping them", () => {
    const i = paymentReviewFixture();
    changeOrders(i, (s) => {
      s.money = {
        items_subtotal: "200.00",
        discount_total: "20.00",
        shipping_total: "10.00",
        shipping_tax: "1.60",
        cart_tax: "29.60",
        total_tax: "31.20",
        fees_total: "5.00",
        refunded_total: "0.00",
        total: "226.20",
      };
      Object.assign(s.lines[0], {
        total: "180.00",
        subtotal_tax: "32.00",
        total_tax: "28.80",
      });
      s.shipping_lines = [{ id: 201, total: "10.00", tax: "1.60" }];
      s.fee_lines = [{ id: 301, total: "5.00", tax: "0.80" }];
      s.coupon_lines = [
        { id: 401, code: "QA20", discount: "20.00", discount_tax: "3.20" },
      ];
    });
    const r = reviewWooPaymentCandidate(i);
    expect(r.disposition).toBe("HOLD");
    expect(r.components_cents).toEqual({
      items_subtotal: 20000,
      discount_total: 2000,
      shipping_total: 1000,
      shipping_tax: 160,
      cart_tax: 2960,
      total_tax: 3120,
      fees_total: 500,
      refunded_total: 0,
      total: 22620,
    });
    expect(r.reasons).toHaveLength(6);
    expect(r.reasons).toContain("NATIVE_COMPONENT_UNSUPPORTED:fees_total");
  });
  for (const k of [
    "items_subtotal",
    "discount_total",
    "shipping_total",
    "shipping_tax",
    "cart_tax",
    "total_tax",
    "fees_total",
    "refunded_total",
    "total",
  ])
    it(`does not silently discard changed ${k}`, () => {
      const i = paymentReviewFixture();
      i.first.money[k] = "0.01";
      held(i, "PAYMENT_COMPONENT_TOTALS_DIFFER");
    });
  it("matches multiple exact variants and allows opposite stable line order", () => {
    const i = paymentReviewFixture();
    changeOrders(i, (s) => {
      s.lines.push({
        ...s.lines[0],
        line_id: 102,
        product_id: 9000009012,
        variation_id: 0,
        variant_id: variant2,
        barcode: "NIÑO-01",
      });
      s.money.items_subtotal = "400.00";
      s.money.total = "400.00";
    });
    i.reservation.lines.unshift({
      ...i.reservation.lines[0],
      line_id: 102,
      product_id: 9000009012,
      variation_id: 0,
      variant_id: variant2,
      barcode: "NIÑO-01",
    });
    expect(reviewWooPaymentCandidate(i).disposition).toBe(
      "REHEARSAL_CANDIDATE",
    );
  });
  it("refuses the same native variant under two Woo identities", () => {
    const i = paymentReviewFixture();
    changeOrders(i, (s) => {
      s.lines.push({
        ...s.lines[0],
        line_id: 102,
        product_id: 9000009012,
        variation_id: 0,
        barcode: "ANOTHER",
      });
    });
    held(i, "PAYMENT_DUPLICATE_VARIANT");
  });
  it("replay retains only prior proof reference and never emits another posting", () => {
    const i = paymentReviewFixture(),
      first = reviewWooPaymentCandidate(i);
    i.ledger.entries.push(entry(i, first));
    const r = reviewWooPaymentCandidate(i);
    expect(r.disposition).toBe("REPLAY_REVIEW");
    expect(r.prior_result_sha256).toBe("b".repeat(64));
    expect(r.can_record_sale).toBe(false);
  });
  for (const [name, patch, reason] of [
    ["another order", { order_id: 12 }, "PAYMENT_REFERENCE_REUSED_OR_CHANGED"],
    [
      "another merchant",
      { merchant_id: "another-merchant" },
      "PAYMENT_REFERENCE_REUSED_OR_CHANGED",
    ],
    [
      "another body",
      { order_sha256: "c".repeat(64) },
      "PAYMENT_REFERENCE_REUSED_OR_CHANGED",
    ],
    [
      "another source",
      { source_sha256: "c".repeat(64) },
      "PAYMENT_REFERENCE_REUSED_OR_CHANGED",
    ],
    [
      "another amount",
      { amount: "199.99" },
      "PAYMENT_REFERENCE_REUSED_OR_CHANGED",
    ],
    [
      "second capture",
      { reference: "qa_capture_previous" },
      "PAYMENT_SECOND_CAPTURE_REQUIRES_REVIEW",
    ],
  ])
    it(`holds reference reused with ${name}`, () => {
      const i = paymentReviewFixture(),
        r = reviewWooPaymentCandidate(i);
      i.ledger.entries.push(entry(i, r, patch));
      held(i, reason);
    });
  it("fails closed on duplicate provider reference ledger entries", () => {
    const i = paymentReviewFixture(),
      r = reviewWooPaymentCandidate(i);
    i.ledger.entries.push(
      entry(i, r),
      entry(i, r, { operation_id: "qa-second" }),
    );
    held(i, "PAYMENT_REFERENCE_LEDGER_DUPLICATE");
  });
  for (const value of [null, undefined, NaN, Infinity, -Infinity, "2", 0, -1])
    it(`rejects malformed line quantity ${String(value)}`, () => {
      const i = paymentReviewFixture();
      i.first.lines[0].quantity = value;
      held(i, "PAYMENT_WHOLE_QUANTITY_REQUIRED");
    });
  for (const value of [
    "2026-02-30T20:59:00.000Z",
    "2026-10-22",
    "10/22/2026 20:59",
    "2026-10-22T20:59:00Z",
    "2026-10-22T20:59:00.000+00:00",
    null,
  ])
    it(`rejects ambiguous/noncanonical read timestamp ${String(value)}`, () => {
      const i = paymentReviewFixture();
      i.first.observed_at = value;
      held(i, "PAYMENT_TIMESTAMP_INVALID");
    });
  it("rejects a control character in the literal barcode", () => {
    const i = paymentReviewFixture();
    i.first.lines[0].barcode = "000236\u0000";
    held(i, "PAYMENT_LITERAL_BARCODE_REQUIRED");
  });
  it("keeps full refund and full physical receipt independent and still held", () => {
    const r = reviewWooPaymentCandidate(refundFixture());
    expect(r.disposition).toBe("HOLD");
    expect(r.reasons).toEqual(["NATIVE_PROVIDER_REFUND_ADAPTER_REQUIRED"]);
    expect(r.physical_receipt_observed).toBe(true);
    expect(r.components_cents.refunded_total).toBe(20000);
    expect(r.stock_write_allowed).toBe(false);
  });
  for (const [label, mutate, reason] of [
    [
      "no physical receipt",
      (i) => {
        i.physical_receipt = null;
      },
      "PAYMENT_PHYSICAL_RECEIPT_REQUIRED",
    ],
    [
      "partial physical receipt",
      (i) => {
        i.physical_receipt.lines[0].quantity = 1;
      },
      "PAYMENT_FULL_PHYSICAL_RECEIPT_REQUIRED",
    ],
    [
      "changed returned barcode",
      (i) => {
        i.physical_receipt.lines[0].barcode = "236";
      },
      "PAYMENT_FULL_PHYSICAL_RECEIPT_REQUIRED",
    ],
    [
      "no original posting",
      (i) => {
        i.ledger.entries = [];
      },
      "PAYMENT_ORIGINAL_POSTING_REQUIRED",
    ],
    [
      "different original amount",
      (i) => {
        i.ledger.entries[0].amount = "199.99";
      },
      "PAYMENT_ORIGINAL_POSTING_REQUIRED",
    ],
    [
      "refund without matching native reference",
      (i) => {
        i.evidence.parent_reference = "another";
      },
      "PAYMENT_FULL_REFUND_REQUIRED",
    ],
    [
      "same capture reference",
      (i) => {
        i.evidence.reference = i.evidence.parent_reference;
      },
      "PAYMENT_FULL_REFUND_REQUIRED",
    ],
    [
      "physical real mode",
      (i) => {
        i.physical_receipt.mode = "LIVE";
      },
      "PAYMENT_PHYSICAL_RECEIPT_SCOPE_INVALID",
    ],
    [
      "stale physical receipt",
      (i) => {
        i.physical_receipt.received_at = "2026-10-21T21:00:00.000Z";
      },
      "PAYMENT_EVIDENCE_NOT_RECENT",
    ],
    [
      "partial refund",
      (i) => {
        i.evidence.amount = "100.00";
      },
      "PAYMENT_CAPTURE_AMOUNT_DIFFERS",
    ],
  ])
    it(`holds ${label}`, () => {
      const i = refundFixture();
      mutate(i);
      held(i, reason);
    });
});
