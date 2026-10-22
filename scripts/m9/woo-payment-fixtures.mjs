// FICTITIOUS offline documents. No actual provider, customer, order or payment.
import { paymentDocumentSha256 } from "./woo-payment-eligibility.mjs";
import {
  WOO_PILOT_ORIGIN,
  WOO_STAGING_PROJECT,
} from "./woo-order-protocol.mjs";
const now = "2026-10-22T21:00:00.000Z";
const variant = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const orderHash = (s) => {
  const { observed_at: ignored, ...body } = s;
  void ignored;
  return paymentDocumentSha256(body);
};
export function paymentReviewFixture() {
  const order = {
    protocol: "m9-woo-payment-order-review-1",
    origin: WOO_PILOT_ORIGIN,
    order_id: 9000009001,
    modified_at: "2026-10-22T20:58:50.000Z",
    observed_at: "2026-10-22T20:59:00.000Z",
    currency: "MXN",
    status: "processing",
    payment: {
      method: "qa_sandbox_gateway",
      transaction_id: "qa_capture_1",
      paid_at: "2026-10-22T20:58:50.000Z",
      is_paid: true,
    },
    money: {
      items_subtotal: "200.00",
      discount_total: "0.00",
      shipping_total: "0.00",
      shipping_tax: "0.00",
      cart_tax: "0.00",
      total_tax: "0.00",
      fees_total: "0.00",
      refunded_total: "0.00",
      total: "200.00",
    },
    lines: [
      {
        line_id: 101,
        product_id: 9000009002,
        variation_id: 9000009003,
        variant_id: variant,
        barcode: "000236",
        quantity: 2,
        subtotal: "200.00",
        total: "200.00",
        subtotal_tax: "0.00",
        total_tax: "0.00",
      },
    ],
    shipping_lines: [],
    fee_lines: [],
    coupon_lines: [],
    refund_lines: [],
  };
  return {
    now,
    first: structuredClone(order),
    second: {
      ...structuredClone(order),
      observed_at: "2026-10-22T20:59:01.000Z",
    },
    policy: {
      project: WOO_STAGING_PROJECT,
      origin: WOO_PILOT_ORIGIN,
      provider: "qa_fixture_provider",
      account_id: "qa_sandbox_account",
      merchant_id: "qa_sandbox_merchant",
      payment_method: "qa_sandbox_gateway",
      mode: "SANDBOX",
    },
    reservation: {
      origin: WOO_PILOT_ORIGIN,
      order_id: order.order_id,
      expected_version: 1,
      lines: [
        {
          line_id: 101,
          product_id: 9000009002,
          variation_id: 9000009003,
          variant_id: variant,
          barcode: "000236",
          quantity: 2,
          unit_price_cents: 10000,
        },
      ],
    },
    evidence: {
      protocol: "m9-sandbox-provider-readback-review-1",
      action: "PAYMENT",
      provider: "qa_fixture_provider",
      account_id: "qa_sandbox_account",
      merchant_id: "qa_sandbox_merchant",
      mode: "SANDBOX",
      live_mode: false,
      origin: WOO_PILOT_ORIGIN,
      order_id: order.order_id,
      order_sha256: orderHash(order),
      currency: "MXN",
      amount: "200.00",
      reference: "qa_capture_1",
      parent_reference: null,
      state: "CAPTURED",
      occurred_at: "2026-10-22T20:58:50.000Z",
      observed_at: "2026-10-22T20:59:02.000Z",
      source_sha256: hash,
    },
    ledger: { complete: true, entries: [] },
    physical_receipt: null,
  };
}
