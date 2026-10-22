// OFFLINE REVIEW ONLY. No database, transport, credentials or posting command.
// A caller-supplied provider document is NOT authenticated by this pure module.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { decimalCents } from "./woo-remote/finance-read.mjs";
import {
  WOO_PILOT_ORIGIN,
  WOO_STAGING_PROJECT,
} from "./woo-order-protocol.mjs";

const reject = (code) => {
  throw Error(code);
};
const exact = (x, keys, code) => {
  if (
    !x ||
    typeof x !== "object" ||
    Array.isArray(x) ||
    Object.keys(x).sort().join("|") !== [...keys].sort().join("|")
  )
    reject(code);
};
const safe = (n, positive = false) =>
  Number.isSafeInteger(n) && n >= (positive ? 1 : 0);
const integer = (n, code, positive = false) => {
  if (!safe(n, positive)) reject(code);
  return n;
};
const text = (s, code, max = 160) => {
  if (
    typeof s !== "string" ||
    !s.length ||
    s.length > max ||
    s !== s.trim() ||
    [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    reject(code);
  return s;
};
const hash = (s, code) => {
  if (typeof s !== "string" || !/^[a-f0-9]{64}$/.test(s)) reject(code);
  return s;
};
const uuid = (s, code) => {
  if (
    typeof s !== "string" ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)
  )
    reject(code);
  return s;
};
const add = (...numbers) => {
  const n = numbers.reduce((a, b) => BigInt(a) + BigInt(b), 0n);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < 0n)
    reject("PAYMENT_MONEY_OVERFLOW");
  return Number(n);
};
const multiply = (a, b) => {
  const n = BigInt(a) * BigInt(b);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) reject("PAYMENT_MONEY_OVERFLOW");
  return Number(n);
};
const sum = (rows, key) => add(...rows.map((x) => x[key]));
const timestamp = (s, code) => {
  if (
    typeof s !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString() !== s
  )
    reject(code);
  return Date.parse(s);
};
const recent = (s, now) => {
  const ms = timestamp(s, "PAYMENT_TIMESTAMP_INVALID");
  if (ms < now - 300000 || ms > now + 5000)
    reject("PAYMENT_EVIDENCE_NOT_RECENT");
  return ms;
};
const array = (a, max, code, min = 0) => {
  if (!Array.isArray(a) || a.length < min || a.length > max) reject(code);
  return a;
};
const unique = (rows, key, code) => {
  if (new Set(rows.map(key)).size !== rows.length) reject(code);
};
const sorted = (a) => [...a].sort((x, y) => x.line_id - y.line_id);
const canonical = (x) =>
  x === null || typeof x !== "object"
    ? x
    : Array.isArray(x)
      ? x.map(canonical)
      : Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        );
export const paymentDocumentSha256 = (x) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(x)))
    .digest("hex");

const moneyKeys = [
  "items_subtotal",
  "discount_total",
  "shipping_total",
  "shipping_tax",
  "cart_tax",
  "total_tax",
  "fees_total",
  "refunded_total",
  "total",
];
const lineIdentity = (l) => ({
  line_id: l.line_id,
  product_id: l.product_id,
  variation_id: l.variation_id,
  variant_id: l.variant_id,
  barcode: l.barcode,
  quantity: l.quantity,
});
function identity(l) {
  integer(l.line_id, "PAYMENT_LINE_ID_INVALID", true);
  integer(l.product_id, "PAYMENT_PRODUCT_ID_INVALID", true);
  integer(l.variation_id, "PAYMENT_VARIATION_ID_INVALID");
  uuid(l.variant_id, "PAYMENT_VARIANT_ID_INVALID");
  text(l.barcode, "PAYMENT_LITERAL_BARCODE_REQUIRED");
  integer(l.quantity, "PAYMENT_WHOLE_QUANTITY_REQUIRED", true);
  if (l.quantity > 999999999) reject("PAYMENT_WHOLE_QUANTITY_REQUIRED");
}
function readOrder(s, now) {
  exact(
    s,
    [
      "protocol",
      "origin",
      "order_id",
      "modified_at",
      "observed_at",
      "currency",
      "status",
      "payment",
      "money",
      "lines",
      "shipping_lines",
      "fee_lines",
      "coupon_lines",
      "refund_lines",
    ],
    "PAYMENT_ORDER_SHAPE_INVALID",
  );
  if (
    s.protocol !== "m9-woo-payment-order-review-1" ||
    s.origin !== WOO_PILOT_ORIGIN
  )
    reject("PAYMENT_TEST_ORDER_REQUIRED");
  integer(s.order_id, "PAYMENT_ORDER_ID_INVALID", true);
  const observed = recent(s.observed_at, now);
  if (timestamp(s.modified_at, "PAYMENT_TIMESTAMP_INVALID") > observed)
    reject("PAYMENT_ORDER_TIME_INCONSISTENT");
  if (s.currency !== "MXN") reject("PAYMENT_MXN_REQUIRED");
  if (
    ![
      "pending",
      "on-hold",
      "processing",
      "completed",
      "cancelled",
      "failed",
      "refunded",
    ].includes(s.status)
  )
    reject("PAYMENT_ORDER_STATUS_INVALID");
  exact(
    s.payment,
    ["method", "transaction_id", "paid_at", "is_paid"],
    "PAYMENT_HINT_SHAPE_INVALID",
  );
  text(s.payment.method, "PAYMENT_METHOD_REQUIRED");
  if (
    typeof s.payment.transaction_id !== "string" ||
    s.payment.transaction_id.length > 160 ||
    typeof s.payment.is_paid !== "boolean"
  )
    reject("PAYMENT_HINT_SHAPE_INVALID");
  if (s.payment.paid_at !== null)
    timestamp(s.payment.paid_at, "PAYMENT_TIMESTAMP_INVALID");
  exact(s.money, moneyKeys, "PAYMENT_COMPONENTS_REQUIRED");
  const money = Object.fromEntries(
    moneyKeys.map((k) => [k, decimalCents(s.money[k])]),
  );
  const lines = array(s.lines, 50, "PAYMENT_LINES_REQUIRED", 1).map((l) => {
    exact(
      l,
      [
        "line_id",
        "product_id",
        "variation_id",
        "variant_id",
        "barcode",
        "quantity",
        "subtotal",
        "total",
        "subtotal_tax",
        "total_tax",
      ],
      "PAYMENT_LINE_SHAPE_INVALID",
    );
    identity(l);
    const n = {
      ...lineIdentity(l),
      ...Object.fromEntries(
        ["subtotal", "total", "subtotal_tax", "total_tax"].map((k) => [
          k,
          decimalCents(l[k]),
        ]),
      ),
    };
    if (n.total > n.subtotal || n.total_tax > n.subtotal_tax)
      reject("PAYMENT_LINE_DISCOUNT_INVALID");
    return n;
  });
  unique(lines, (l) => l.line_id, "PAYMENT_DUPLICATE_LINE");
  unique(lines, (l) => l.variant_id, "PAYMENT_DUPLICATE_VARIANT");
  unique(
    lines,
    (l) => `${l.product_id}/${l.variation_id}`,
    "PAYMENT_DUPLICATE_WOO_IDENTITY",
  );
  unique(lines, (l) => l.barcode, "PAYMENT_DUPLICATE_BARCODE");
  const componentLines = (a, code) => {
    const rows = array(a, 50, code).map((l) => {
      exact(l, ["id", "total", "tax"], code);
      integer(l.id, code, true);
      return {
        id: l.id,
        total: decimalCents(l.total),
        tax: decimalCents(l.tax),
      };
    });
    unique(rows, (l) => l.id, code);
    return rows;
  };
  const shipping = componentLines(
    s.shipping_lines,
    "PAYMENT_SHIPPING_LINES_INVALID",
  );
  const fees = componentLines(s.fee_lines, "PAYMENT_FEE_LINES_INVALID");
  const coupons = array(s.coupon_lines, 50, "PAYMENT_COUPONS_INVALID").map(
    (l) => {
      exact(
        l,
        ["id", "code", "discount", "discount_tax"],
        "PAYMENT_COUPONS_INVALID",
      );
      integer(l.id, "PAYMENT_COUPONS_INVALID", true);
      text(l.code, "PAYMENT_COUPONS_INVALID");
      return {
        id: l.id,
        code: l.code,
        discount: decimalCents(l.discount),
        discount_tax: decimalCents(l.discount_tax),
      };
    },
  );
  unique(coupons, (l) => l.id, "PAYMENT_DUPLICATE_COUPON");
  unique(coupons, (l) => l.code, "PAYMENT_DUPLICATE_COUPON");
  const refunds = array(s.refund_lines, 50, "PAYMENT_REFUNDS_INVALID").map(
    (l) => {
      exact(
        l,
        ["id", "reference", "amount", "currency"],
        "PAYMENT_REFUNDS_INVALID",
      );
      integer(l.id, "PAYMENT_REFUNDS_INVALID", true);
      text(l.reference, "PAYMENT_REFUNDS_INVALID");
      if (l.currency !== "MXN") reject("PAYMENT_REFUNDS_INVALID");
      const amount = decimalCents(l.amount);
      if (!amount) reject("PAYMENT_REFUNDS_INVALID");
      return { id: l.id, reference: l.reference, amount, currency: l.currency };
    },
  );
  unique(refunds, (l) => l.id, "PAYMENT_DUPLICATE_REFUND");
  unique(refunds, (l) => l.reference, "PAYMENT_DUPLICATE_REFUND");
  if (
    sum(lines, "subtotal") !== money.items_subtotal ||
    sum(lines, "subtotal") - sum(lines, "total") !== money.discount_total ||
    sum(coupons, "discount") !== money.discount_total ||
    sum(lines, "subtotal_tax") - sum(lines, "total_tax") !==
      sum(coupons, "discount_tax") ||
    sum(shipping, "total") !== money.shipping_total ||
    sum(shipping, "tax") !== money.shipping_tax ||
    sum(fees, "total") !== money.fees_total ||
    add(sum(lines, "total_tax"), sum(fees, "tax")) !== money.cart_tax ||
    add(money.cart_tax, money.shipping_tax) !== money.total_tax ||
    add(
      sum(lines, "total"),
      money.shipping_total,
      money.fees_total,
      money.total_tax,
    ) !== money.total ||
    sum(refunds, "amount") !== money.refunded_total ||
    money.refunded_total > money.total ||
    money.total <= 0
  )
    reject("PAYMENT_COMPONENT_TOTALS_DIFFER");
  const { observed_at: observedAt, ...body } = s;
  const { refunded_total: refundedTotal, ...commercialMoney } = money;
  // A status/date/refund update changes the full read hash, not the original
  // commercial identity. Price/quantity/barcode/tax/fees/coupon changes do.
  return {
    body_sha256: paymentDocumentSha256(body),
    commercial_sha256: paymentDocumentSha256({
      origin: s.origin,
      order_id: s.order_id,
      currency: s.currency,
      money: commercialMoney,
      lines: sorted(lines),
      shipping,
      fees,
      coupons,
    }),
    observed_at: observedAt,
    refunded_total: refundedTotal,
    money,
    lines: sorted(lines),
    refunds,
  };
}

function policy(p) {
  exact(
    p,
    [
      "project",
      "origin",
      "provider",
      "account_id",
      "merchant_id",
      "payment_method",
      "mode",
    ],
    "PAYMENT_POLICY_INVALID",
  );
  if (
    p.project !== WOO_STAGING_PROJECT ||
    p.origin !== WOO_PILOT_ORIGIN ||
    p.mode !== "SANDBOX"
  )
    reject("PAYMENT_STAGING_SANDBOX_REQUIRED");
  for (const k of ["provider", "account_id", "merchant_id", "payment_method"])
    text(p[k], "PAYMENT_PROVIDER_CONFIGURATION_REQUIRED");
  if (
    [
      "cash",
      "card",
      "transfer",
      "cod",
      "bacs",
      "cheque",
      "m9_synthetic_no_payment",
      "m9_web_test",
    ].includes(p.payment_method.toLowerCase())
  )
    reject("PAYMENT_NON_GATEWAY_METHOD_FORBIDDEN");
}
function readEvidence(e, p, s, review, now) {
  exact(
    e,
    [
      "protocol",
      "action",
      "provider",
      "account_id",
      "merchant_id",
      "mode",
      "live_mode",
      "origin",
      "order_id",
      "order_sha256",
      "currency",
      "amount",
      "reference",
      "parent_reference",
      "state",
      "occurred_at",
      "observed_at",
      "source_sha256",
    ],
    "PAYMENT_PROVIDER_EVIDENCE_REQUIRED",
  );
  if (
    e.protocol !== "m9-sandbox-provider-readback-review-1" ||
    e.mode !== "SANDBOX" ||
    e.live_mode !== false
  )
    reject("PAYMENT_SANDBOX_PROOF_REQUIRED");
  for (const k of ["provider", "account_id", "merchant_id", "origin"])
    if (e[k] !== p[k]) reject("PAYMENT_PROVIDER_IDENTITY_CHANGED");
  if (e.order_id !== s.order_id || e.currency !== s.currency)
    reject("PAYMENT_PROVIDER_ORDER_CHANGED");
  hash(e.order_sha256, "PAYMENT_ORDER_HASH_REQUIRED");
  hash(e.source_sha256, "PAYMENT_SOURCE_HASH_REQUIRED");
  if (e.order_sha256 !== review.body_sha256)
    reject("PAYMENT_ORDER_CHANGED_AFTER_CAPTURE");
  const observed = recent(e.observed_at, now);
  if (timestamp(e.occurred_at, "PAYMENT_TIMESTAMP_INVALID") > observed)
    reject("PAYMENT_PROVIDER_TIME_INCONSISTENT");
  if (observed < timestamp(s.observed_at, "PAYMENT_TIMESTAMP_INVALID"))
    reject("PAYMENT_PROVIDER_READ_BEFORE_ORDER_READ");
  text(e.reference, "PAYMENT_REFERENCE_REQUIRED");
  if (!["PAYMENT", "FULL_CANCEL"].includes(e.action))
    reject("PAYMENT_ACTION_UNSUPPORTED");
  const amount = decimalCents(e.amount);
  if (amount !== review.money.total) reject("PAYMENT_CAPTURE_AMOUNT_DIFFERS");
  if (e.action === "PAYMENT") {
    if (e.state !== "CAPTURED" || e.parent_reference !== null)
      reject("PAYMENT_CAPTURE_REQUIRED");
    if (
      !["processing", "completed"].includes(s.status) ||
      !s.payment.is_paid ||
      s.payment.paid_at === null ||
      s.payment.transaction_id !== e.reference ||
      s.payment.method !== p.payment_method
    )
      reject("PAYMENT_ORDER_HINTS_INCONSISTENT");
    if (timestamp(s.payment.paid_at, "PAYMENT_TIMESTAMP_INVALID") > observed)
      reject("PAYMENT_ORDER_TIME_INCONSISTENT");
    if (review.refunded_total !== 0) reject("PAYMENT_ALREADY_REFUNDED");
  } else {
    text(e.parent_reference, "PAYMENT_ORIGINAL_REFERENCE_REQUIRED");
    if (e.state !== "REFUNDED" || e.reference === e.parent_reference)
      reject("PAYMENT_FULL_REFUND_REQUIRED");
    if (
      s.status !== "refunded" ||
      s.payment.transaction_id !== e.parent_reference ||
      s.payment.method !== p.payment_method ||
      review.refunded_total !== amount ||
      review.refunds.length !== 1 ||
      review.refunds[0].reference !== e.reference
    )
      reject("PAYMENT_FULL_REFUND_REQUIRED");
  }
}
function reservation(r, order, review) {
  exact(
    r,
    ["origin", "order_id", "expected_version", "lines"],
    "PAYMENT_RESERVATION_REQUIRED",
  );
  if (r.origin !== order.origin || r.order_id !== order.order_id)
    reject("PAYMENT_RESERVATION_ORDER_CHANGED");
  integer(r.expected_version, "PAYMENT_RESERVATION_VERSION_INVALID");
  if (r.expected_version > 999999999999999)
    reject("PAYMENT_RESERVATION_VERSION_INVALID");
  const rows = array(r.lines, 50, "PAYMENT_RESERVATION_LINES_INVALID", 1).map(
    (l) => {
      exact(
        l,
        [
          "line_id",
          "product_id",
          "variation_id",
          "variant_id",
          "barcode",
          "quantity",
          "unit_price_cents",
        ],
        "PAYMENT_RESERVATION_LINES_INVALID",
      );
      identity(l);
      integer(l.unit_price_cents, "PAYMENT_PUBLIC_PRICE_REQUIRED", true);
      return l;
    },
  );
  unique(rows, (l) => l.line_id, "PAYMENT_DUPLICATE_RESERVATION");
  if (
    !isDeepStrictEqual(
      sorted(rows).map(lineIdentity),
      review.lines.map(lineIdentity),
    )
  )
    reject("PAYMENT_RESERVATION_IDENTITY_CHANGED");
  if (
    sorted(rows).some(
      (l, i) =>
        multiply(l.unit_price_cents, l.quantity) !== review.lines[i].subtotal,
    )
  )
    reject("PAYMENT_PUBLIC_PRICE_CHANGED");
}
function ledger(l, e, review) {
  exact(l, ["complete", "entries"], "PAYMENT_REFERENCE_LEDGER_REQUIRED");
  if (l.complete !== true) reject("PAYMENT_REFERENCE_LEDGER_INCOMPLETE");
  const rows = array(l.entries, 10000, "PAYMENT_REFERENCE_LEDGER_INVALID");
  for (const row of rows) {
    exact(
      row,
      [
        "provider",
        "account_id",
        "merchant_id",
        "origin",
        "currency",
        "reference",
        "action",
        "order_id",
        "commercial_sha256",
        "order_sha256",
        "source_sha256",
        "amount",
        "operation_id",
        "result_sha256",
      ],
      "PAYMENT_REFERENCE_LEDGER_INVALID",
    );
    for (const k of [
      "provider",
      "account_id",
      "merchant_id",
      "reference",
      "operation_id",
    ])
      text(row[k], "PAYMENT_REFERENCE_LEDGER_INVALID");
    if (row.origin !== WOO_PILOT_ORIGIN || row.currency !== "MXN")
      reject("PAYMENT_REFERENCE_LEDGER_SCOPE_INVALID");
    integer(row.order_id, "PAYMENT_REFERENCE_LEDGER_INVALID", true);
    if (!["PAYMENT", "FULL_CANCEL"].includes(row.action))
      reject("PAYMENT_REFERENCE_LEDGER_INVALID");
    for (const k of [
      "commercial_sha256",
      "order_sha256",
      "source_sha256",
      "result_sha256",
    ])
      hash(row[k], "PAYMENT_REFERENCE_LEDGER_INVALID");
    decimalCents(row.amount);
  }
  unique(
    rows,
    (r) => `${r.provider}/${r.account_id}/${r.reference}`,
    "PAYMENT_REFERENCE_LEDGER_DUPLICATE",
  );
  unique(
    rows,
    (r) => `${r.provider}/${r.account_id}/${r.operation_id}`,
    "PAYMENT_OPERATION_LEDGER_DUPLICATE",
  );
  const prior = rows.find(
    (r) =>
      r.provider === e.provider &&
      r.account_id === e.account_id &&
      r.reference === e.reference,
  );
  if (prior) {
    if (
      prior.action !== e.action ||
      prior.merchant_id !== e.merchant_id ||
      prior.origin !== e.origin ||
      prior.currency !== e.currency ||
      prior.order_id !== e.order_id ||
      prior.commercial_sha256 !== review.commercial_sha256 ||
      prior.order_sha256 !== review.body_sha256 ||
      prior.source_sha256 !== e.source_sha256 ||
      prior.amount !== e.amount
    )
      reject("PAYMENT_REFERENCE_REUSED_OR_CHANGED");
    return prior;
  }
  const sameOrder = rows.filter(
    (r) =>
      r.provider === e.provider &&
      r.account_id === e.account_id &&
      r.order_id === e.order_id,
  );
  if (e.action === "PAYMENT" && sameOrder.length)
    reject("PAYMENT_SECOND_CAPTURE_REQUIRES_REVIEW");
  if (e.action === "FULL_CANCEL") {
    const original = sameOrder.filter(
      (r) =>
        r.action === "PAYMENT" &&
        r.merchant_id === e.merchant_id &&
        r.origin === e.origin &&
        r.currency === e.currency &&
        r.reference === e.parent_reference &&
        r.commercial_sha256 === review.commercial_sha256 &&
        r.amount === e.amount,
    );
    if (original.length !== 1) reject("PAYMENT_ORIGINAL_POSTING_REQUIRED");
    if (sameOrder.some((r) => r.action === "FULL_CANCEL"))
      reject("PAYMENT_SECOND_REFUND_REQUIRES_REVIEW");
  }
  return null;
}
function physical(receipt, e, review, now) {
  if (e.action === "PAYMENT") {
    if (receipt !== null) reject("PAYMENT_UNEXPECTED_PHYSICAL_RECEIPT");
    return;
  }
  exact(
    receipt,
    ["mode", "origin", "order_id", "reference", "received_at", "lines"],
    "PAYMENT_PHYSICAL_RECEIPT_REQUIRED",
  );
  if (
    receipt.mode !== "SANDBOX_TEST_ONLY" ||
    receipt.origin !== e.origin ||
    receipt.order_id !== e.order_id
  )
    reject("PAYMENT_PHYSICAL_RECEIPT_SCOPE_INVALID");
  text(receipt.reference, "PAYMENT_PHYSICAL_RECEIPT_REQUIRED");
  recent(receipt.received_at, now);
  const rows = array(
    receipt.lines,
    50,
    "PAYMENT_FULL_PHYSICAL_RECEIPT_REQUIRED",
    1,
  );
  for (const row of rows) {
    exact(
      row,
      ["line_id", "variant_id", "barcode", "quantity"],
      "PAYMENT_FULL_PHYSICAL_RECEIPT_REQUIRED",
    );
    integer(row.line_id, "PAYMENT_FULL_PHYSICAL_RECEIPT_REQUIRED", true);
    uuid(row.variant_id, "PAYMENT_FULL_PHYSICAL_RECEIPT_REQUIRED");
    text(row.barcode, "PAYMENT_LITERAL_BARCODE_REQUIRED");
    integer(row.quantity, "PAYMENT_WHOLE_QUANTITY_REQUIRED", true);
  }
  const expected = review.lines.map(
    ({ line_id, variant_id, barcode, quantity }) => ({
      line_id,
      variant_id,
      barcode,
      quantity,
    }),
  );
  if (!isDeepStrictEqual(sorted(rows), expected))
    reject("PAYMENT_FULL_PHYSICAL_RECEIPT_REQUIRED");
}

/**
 * Structural review only. Input documents and hashes can be fabricated by a
 * caller. The result NEVER authorizes native SQL, a sale, stock or a ticket.
 * A future transport must authenticate TWO Woo reads and the provider readback,
 * persist a complete reference ledger, then revalidate atomically under locks.
 */
export function reviewWooPaymentCandidate(input) {
  const base = {
    protocol: "m9-woo-payment-eligibility-report-1",
    source_documents_authenticated: false,
    authenticated_provider_adapter_installed: false,
    requires_authenticated_readback: true,
    can_record_sale: false,
    can_issue_sale_ticket: false,
    stock_write_allowed: false,
    database_command: null,
  };
  try {
    exact(
      input,
      [
        "first",
        "second",
        "evidence",
        "reservation",
        "policy",
        "ledger",
        "physical_receipt",
        "now",
      ],
      "PAYMENT_REVIEW_INPUT_INVALID",
    );
    const now = timestamp(input.now, "PAYMENT_EXPLICIT_CLOCK_REQUIRED");
    policy(input.policy);
    const first = readOrder(input.first, now),
      second = readOrder(input.second, now);
    if (
      first.body_sha256 !== second.body_sha256 ||
      Date.parse(input.first.observed_at) > Date.parse(input.second.observed_at)
    )
      reject("PAYMENT_ORDER_NOT_STABLE");
    readEvidence(input.evidence, input.policy, input.second, second, now);
    reservation(input.reservation, input.second, second);
    const prior = ledger(input.ledger, input.evidence, second);
    physical(input.physical_receipt, input.evidence, second, now);
    const held = [
      ...moneyKeys
        .filter(
          (k) => !["items_subtotal", "total", "refunded_total"].includes(k),
        )
        .filter((k) => second.money[k] !== 0)
        .map((k) => `NATIVE_COMPONENT_UNSUPPORTED:${k}`),
      ...(input.evidence.action === "FULL_CANCEL"
        ? ["NATIVE_PROVIDER_REFUND_ADAPTER_REQUIRED"]
        : []),
    ];
    return {
      ...base,
      disposition: held.length
        ? "HOLD"
        : prior
          ? "REPLAY_REVIEW"
          : "REHEARSAL_CANDIDATE",
      reasons: held.sort(),
      review_only: true,
      synthetic_sql_evidence_allowed: false,
      order_id: input.second.order_id,
      action: input.evidence.action,
      order_sha256: second.body_sha256,
      commercial_sha256: second.commercial_sha256,
      source_sha256: input.evidence.source_sha256,
      components_cents: second.money,
      line_count: second.lines.length,
      prior_result_sha256: prior?.result_sha256 ?? null,
      physical_receipt_observed: input.physical_receipt !== null,
      next_gate:
        "AUTHENTICATED_PROVIDER_TRANSPORT_AND_ATOMIC_SERVER_REVALIDATION",
    };
  } catch (error) {
    return {
      ...base,
      disposition: "HOLD",
      review_only: true,
      reasons: [error.message],
      next_gate: "MANUAL_REVIEW_OF_SOURCE_DOCUMENTS",
    };
  }
}
