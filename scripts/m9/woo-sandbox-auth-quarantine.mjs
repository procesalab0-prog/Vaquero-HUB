// INERT LOCAL QA ONLY. No HTTP listener, provider adapter, SQL or native writes.
import { createHash, createPublicKey, verify, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  open,
  readdir,
  readFile,
  link,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { decimalCents } from "./woo-remote/finance-read.mjs";
import {
  WOO_PILOT_ORIGIN,
  WOO_STAGING_PROJECT,
} from "./woo-order-protocol.mjs";

export const SANDBOX_PROVIDER_RECEIVER = Object.freeze({
  enabled: false,
  accredited_providers: Object.freeze([]),
  public_route_installed: false,
  book_write_allowed: false,
});
export function receiveSandboxProviderEvidence() {
  // Deliberately no caller-supplied enabled/profile/key override.
  throw Error("SANDBOX_PROVIDER_NOT_ACCREDITED_RECEIVER_DISABLED");
}
export const canonicalQaJson = (v) => JSON.stringify(sort(v));
function sort(v) {
  return v === null || typeof v !== "object"
    ? v
    : Array.isArray(v)
      ? v.map(sort)
      : Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sort(v[k])]),
        );
}
const sha = (v) => createHash("sha256").update(v).digest("hex");
const fail = (code) => {
  throw Error(code);
};
const exact = (v, keys, code) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join("|") !== [...keys].sort().join("|")
  )
    fail(code);
};
const synthetic = (s, code) => {
  if (typeof s !== "string" || !/^SYNTHETIC-[A-Za-z0-9:_-]{1,100}$/.test(s))
    fail(code);
};
const stamp = (s) => {
  if (
    typeof s !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString() !== s
  )
    fail("QA_TIMESTAMP_INVALID");
  return Date.parse(s);
};
const nonnegativeTotal = (...a) => {
  const n = a.reduce((s, v) => s + BigInt(v), 0n);
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
    fail("QA_MONEY_CONSERVATION_INVALID");
  return Number(n);
};
const relatedKinds = Object.freeze({
  REFUND: "CAPTURE",
  PROVIDER_FEE: "CAPTURE",
  FEE_REVERSAL: "PROVIDER_FEE",
});
const kinds = [
  "AUTHORIZATION",
  "CAPTURE",
  "REFUND",
  "PROVIDER_FEE",
  "FEE_REVERSAL",
  "SETTLEMENT",
];
const moneyKeys = [
  "items_subtotal",
  "discount_total",
  "shipping_total",
  "shipping_tax",
  "cart_tax",
  "total_tax",
  "fees_total",
  "fee_tax",
  "total",
];

/** Verifies only the pinned LOCAL QA key. Never authenticates a provider. */
export function verifyLocalSandboxAttestation({ raw, signature, trust, now }) {
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 65536)
    fail("QA_SIGNED_BODY_SIZE_INVALID");
  exact(
    trust,
    [
      "mode",
      "issuer",
      "key_id",
      "public_key_pem",
      "account_id",
      "merchant_id",
      "valid_from",
      "valid_until",
      "revoked",
    ],
    "QA_PINNED_TRUST_REQUIRED",
  );
  if (
    trust.mode !== "LOCAL_QA_ONLY" ||
    trust.issuer !== "M9_LOCAL_QA_NOT_A_GATEWAY" ||
    trust.revoked !== false
  )
    fail("QA_TRUST_SCOPE_INVALID");
  synthetic(trust.key_id, "QA_KEY_ID_INVALID");
  synthetic(trust.account_id, "QA_ACCOUNT_INVALID");
  synthetic(trust.merchant_id, "QA_MERCHANT_INVALID");
  const clock = stamp(now);
  if (stamp(trust.valid_from) > clock || stamp(trust.valid_until) <= clock)
    fail("QA_KEY_OUTSIDE_VALIDITY");
  if (
    typeof trust.public_key_pem !== "string" ||
    trust.public_key_pem.length > 1000 ||
    !trust.public_key_pem.startsWith("-----BEGIN PUBLIC KEY-----")
  )
    fail("QA_PUBLIC_KEY_REQUIRED");
  let key;
  try {
    key = createPublicKey(trust.public_key_pem);
  } catch {
    fail("QA_PUBLIC_KEY_REQUIRED");
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519")
    fail("QA_ED25519_PIN_REQUIRED");
  if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature))
    fail("QA_SIGNATURE_INVALID");
  const sig = Buffer.from(signature, "base64");
  if (
    sig.length !== 64 ||
    sig.toString("base64") !== signature ||
    !verify(null, raw, key, sig)
  )
    fail("QA_SIGNATURE_INVALID");
  let body, decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    body = JSON.parse(decoded);
  } catch {
    fail("QA_SIGNED_JSON_INVALID");
  }
  // Exact canonical bytes reject duplicate keys, whitespace variants and -0;
  // signature is checked over original bytes before any JSON normalization.
  if (
    !Buffer.from(decoded, "utf8").equals(raw) ||
    canonicalQaJson(body) !== decoded
  )
    fail("QA_CANONICAL_SIGNED_JSON_REQUIRED");
  exact(
    body,
    [
      "protocol",
      "audience",
      "issuer",
      "key_id",
      "mode",
      "live_mode",
      "project",
      "origin",
      "account_id",
      "merchant_id",
      "nonce",
      "issued_at",
      "expires_at",
      "event",
    ],
    "QA_ATTESTATION_SHAPE_INVALID",
  );
  if (
    body.protocol !== "m9-local-sandbox-attestation-1" ||
    body.audience !== "m9-local-quarantine-only" ||
    body.issuer !== trust.issuer ||
    body.key_id !== trust.key_id
  )
    fail("QA_SIGNED_CONTEXT_INVALID");
  if (
    body.mode !== "LOCAL_QA_ONLY" ||
    body.live_mode !== false ||
    body.project !== WOO_STAGING_PROJECT ||
    body.origin !== WOO_PILOT_ORIGIN
  )
    fail("QA_STAGING_SANDBOX_REQUIRED");
  if (
    body.account_id !== trust.account_id ||
    body.merchant_id !== trust.merchant_id
  )
    fail("QA_SIGNED_ACCOUNT_CHANGED");
  if (
    typeof body.nonce !== "string" ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.nonce)
  )
    fail("QA_NONCE_REQUIRED");
  const issued = stamp(body.issued_at),
    expiry = stamp(body.expires_at);
  if (
    issued < clock - 300000 ||
    issued > clock + 5000 ||
    expiry <= clock ||
    expiry <= issued ||
    expiry > issued + 300000
  )
    fail("QA_ATTESTATION_NOT_RECENT");
  const e = body.event;
  exact(
    e,
    [
      "kind",
      "event_reference",
      "transaction_reference",
      "related_transaction_reference",
      "order_id",
      "currency",
      "amount",
      "order_components",
      "provider_fee",
      "settlement",
    ],
    "QA_EVENT_SHAPE_INVALID",
  );
  if (!kinds.includes(e.kind)) fail("QA_EVENT_KIND_UNSUPPORTED");
  synthetic(e.event_reference, "QA_EVENT_REFERENCE_INVALID");
  synthetic(e.transaction_reference, "QA_MONETARY_REFERENCE_INVALID");
  if (
    !Number.isSafeInteger(e.order_id) ||
    e.order_id <= 0 ||
    e.currency !== "MXN"
  )
    fail("QA_ORDER_CURRENCY_INVALID");
  if (relatedKinds[e.kind])
    synthetic(e.related_transaction_reference, "QA_PARENT_REFERENCE_REQUIRED");
  else if (e.related_transaction_reference !== null)
    fail("QA_UNEXPECTED_PARENT_REFERENCE");
  exact(e.order_components, moneyKeys, "QA_COMMERCIAL_COMPONENTS_REQUIRED");
  const commercial = Object.fromEntries(
    moneyKeys.map((k) => [k, decimalCents(e.order_components[k])]),
  );
  const amount = decimalCents(e.amount),
    providerFee = decimalCents(e.provider_fee);
  if (
    amount <= 0 ||
    commercial.total <= 0 ||
    commercial.fee_tax > commercial.cart_tax ||
    nonnegativeTotal(commercial.cart_tax, commercial.shipping_tax) !==
      commercial.total_tax ||
    nonnegativeTotal(
      commercial.items_subtotal,
      -commercial.discount_total,
      commercial.shipping_total,
      commercial.fees_total,
      commercial.total_tax,
    ) !== commercial.total
  )
    fail("QA_MONEY_CONSERVATION_INVALID");
  if (
    ["AUTHORIZATION", "CAPTURE", "REFUND"].includes(e.kind) &&
    amount > commercial.total
  )
    fail("QA_ORDER_AMOUNT_EXCEEDED");
  if (
    (e.kind === "PROVIDER_FEE" && providerFee !== amount) ||
    (e.kind !== "PROVIDER_FEE" && providerFee !== 0)
  )
    fail("QA_PROVIDER_FEE_NOT_ORDER_FEE");
  let settlement = null;
  if (e.kind === "SETTLEMENT") {
    exact(
      e.settlement,
      [
        "gross_captured",
        "refunded",
        "provider_fees",
        "fee_reversals",
        "prior_settlements",
        "net",
      ],
      "QA_SETTLEMENT_COMPONENTS_REQUIRED",
    );
    settlement = Object.fromEntries(
      Object.entries(e.settlement).map(([k, v]) => [k, decimalCents(v)]),
    );
    if (
      nonnegativeTotal(
        settlement.gross_captured,
        -settlement.refunded,
        -settlement.provider_fees,
        settlement.fee_reversals,
        -settlement.prior_settlements,
      ) !== settlement.net ||
      settlement.net !== amount
    )
      fail("QA_SETTLEMENT_NET_DIFFERS");
  } else if (e.settlement !== null) fail("QA_UNEXPECTED_SETTLEMENT");
  return {
    protocol: "m9-local-verified-quarantine-1",
    status: "QUARANTINED",
    local_signature_valid: true,
    trust_class: "LOCAL_QA_SIGNATURE_ONLY_NOT_PROVIDER",
    provider_authenticated: false,
    provider_receiver_enabled: false,
    can_record_sale: false,
    can_record_book_event: false,
    stock_write_allowed: false,
    database_command: null,
    book_event_proposal: null,
    raw_sha256: sha(raw),
    signature_sha256: sha(sig),
    public_key_sha256: sha(key.export({ format: "der", type: "spki" })),
    issuer: body.issuer,
    key_id: body.key_id,
    account_id: body.account_id,
    merchant_id: body.merchant_id,
    project: body.project,
    origin: body.origin,
    nonce: body.nonce,
    issued_at: body.issued_at,
    expires_at: body.expires_at,
    event: {
      kind: e.kind,
      event_reference: e.event_reference,
      transaction_reference: e.transaction_reference,
      related_transaction_reference: e.related_transaction_reference,
      order_id: e.order_id,
      currency: e.currency,
      amount_cents: amount,
      commercial_components_cents: commercial,
      provider_fee_cents: providerFee,
      settlement_components_cents: settlement,
      bank_verified: false,
    },
    reasons: [
      "PROVIDER_NOT_ACCREDITED",
      "LOCAL_SIGNATURE_IS_NOT_PROVIDER_EVIDENCE",
    ],
  };
}

async function privateDirectory(path) {
  await mkdir(path, { mode: 0o700, recursive: true });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 0o077)
    fail("QUARANTINE_PRIVATE_DIRECTORY_REQUIRED");
}
function checkReceipt(receipt, name) {
  exact(
    receipt,
    ["protocol", "receipt_id", "record", "attestation", "receipt_sha256"],
    "QUARANTINE_RECEIPT_INVALID",
  );
  if (
    receipt.protocol !== "m9-local-quarantine-receipt-1" ||
    receipt.receipt_id + ".json" !== name ||
    !/^[a-f0-9]{64}$/.test(receipt.receipt_id) ||
    receipt.record?.raw_sha256 !== receipt.receipt_id ||
    sha(
      canonicalQaJson({
        protocol: receipt.protocol,
        receipt_id: receipt.receipt_id,
        record: receipt.record,
        attestation: receipt.attestation,
      }),
    ) !== receipt.receipt_sha256 ||
    receipt.record.provider_authenticated !== false ||
    receipt.record.can_record_book_event !== false ||
    receipt.record.can_record_sale !== false ||
    receipt.record.stock_write_allowed !== false
  )
    fail("QUARANTINE_RECEIPT_INVALID");
  exact(
    receipt.attestation,
    ["raw_base64", "signature", "public_key_pem"],
    "QUARANTINE_RECEIPT_INVALID",
  );
  const raw = Buffer.from(receipt.attestation.raw_base64, "base64");
  if (
    raw.toString("base64") !== receipt.attestation.raw_base64 ||
    sha(raw) !== receipt.receipt_id
  )
    fail("QUARANTINE_RECEIPT_INVALID");
  const original = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(raw),
  );
  const checked = verifyLocalSandboxAttestation({
    raw,
    signature: receipt.attestation.signature,
    now: original.issued_at,
    trust: {
      mode: "LOCAL_QA_ONLY",
      issuer: original.issuer,
      key_id: original.key_id,
      public_key_pem: receipt.attestation.public_key_pem,
      account_id: original.account_id,
      merchant_id: original.merchant_id,
      valid_from: original.issued_at,
      valid_until: original.expires_at,
      revoked: false,
    },
  });
  exact(receipt.record, Object.keys(checked), "QUARANTINE_RECEIPT_INVALID");
  for (const key of Object.keys(checked).filter(
    (k) => !["status", "reasons"].includes(k),
  ))
    if (canonicalQaJson(receipt.record[key]) !== canonicalQaJson(checked[key]))
      fail("QUARANTINE_RECEIPT_INVALID");
  if (!["QUARANTINED", "QUARANTINED_CONFLICT"].includes(receipt.record.status))
    fail("QUARANTINE_RECEIPT_INVALID");
  return receipt;
}
async function loadReceipts(directory) {
  const names = (await readdir(directory)).sort();
  const records = [];
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name))
      fail("QUARANTINE_UNEXPECTED_FILE_REVIEW_REQUIRED");
    const path = join(directory, name),
      s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink() || s.size > 131072 || s.mode & 0o077)
      fail("QUARANTINE_RECEIPT_INVALID");
    records.push(checkReceipt(JSON.parse(await readFile(path, "utf8")), name));
  }
  return records;
}
function identity(record, referenceField, kind = false) {
  return canonicalQaJson([
    record.issuer,
    record.account_id,
    ...(kind ? [record.event.kind] : []),
    record.event[referenceField],
  ]);
}

/** Local append-once quarantine. No API result can be sent to the SQL book. */
export async function quarantineLocalSandboxAttestation({
  directory,
  ...input
}) {
  const record = verifyLocalSandboxAttestation(input),
    root = resolve(directory);
  await privateDirectory(root);
  await privateDirectory(join(root, "receipts"));
  const lockPath = join(root, "write.lock");
  let lock,
    waits = 0;
  for (let i = 0; i < 100; i++) {
    try {
      lock = await open(lockPath, "wx", 0o600);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      waits++;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  if (!lock) fail("QUARANTINE_WRITE_BARRIER_REVIEW_REQUIRED");
  let pending;
  try {
    await lock.writeFile(
      canonicalQaJson({ purpose: "LOCAL_QA_QUARANTINE", pid: process.pid }),
    );
    await lock.sync();
    const receipts = await loadReceipts(join(root, "receipts"));
    const exactReplay = receipts.find(
      (r) => r.receipt_id === record.raw_sha256,
    );
    if (exactReplay) {
      if (
        exactReplay.record.public_key_sha256 !== record.public_key_sha256 ||
        exactReplay.record.signature_sha256 !== record.signature_sha256
      )
        fail("QUARANTINE_REPLAY_KEY_CHANGED");
      return { ...exactReplay, replayed: true, lock_waits: waits };
    }
    const conflicts = [];
    for (const prior of receipts) {
      if (
        prior.record.nonce === record.nonce &&
        prior.record.issuer === record.issuer
      )
        conflicts.push("NONCE_REUSED_WITH_DIFFERENT_BODY");
      if (
        identity(prior.record, "event_reference") ===
        identity(record, "event_reference")
      )
        conflicts.push("EVENT_REFERENCE_REUSED_WITH_DIFFERENT_BODY");
      if (
        identity(prior.record, "transaction_reference", true) ===
        identity(record, "transaction_reference", true)
      )
        conflicts.push("MONETARY_TRANSACTION_REUSED_WITH_NEW_EVENT");
    }
    if (conflicts.length) {
      record.status = "QUARANTINED_CONFLICT";
      record.reasons = [...new Set([...record.reasons, ...conflicts])].sort();
    }
    const expectedParent = relatedKinds[record.event.kind];
    if (expectedParent) {
      const parent = receipts.filter(
        (r) =>
          r.record.status === "QUARANTINED" &&
          r.record.issuer === record.issuer &&
          r.record.account_id === record.account_id &&
          r.record.merchant_id === record.merchant_id &&
          r.record.origin === record.origin &&
          r.record.event.order_id === record.event.order_id &&
          r.record.event.currency === record.event.currency &&
          r.record.event.kind === expectedParent &&
          r.record.event.transaction_reference ===
            record.event.related_transaction_reference,
      );
      if (parent.length !== 1)
        record.reasons.push("CAUSAL_PARENT_NOT_CONFIRMED_IN_LOCAL_QUARANTINE");
    }
    record.reasons = [...new Set(record.reasons)].sort();
    const body = {
      protocol: "m9-local-quarantine-receipt-1",
      receipt_id: record.raw_sha256,
      record,
      attestation: {
        raw_base64: input.raw.toString("base64"),
        signature: input.signature,
        public_key_pem: input.trust.public_key_pem,
      },
    };
    const receipt = { ...body, receipt_sha256: sha(canonicalQaJson(body)) };
    pending = join(root, "receipts", ".pending-" + randomUUID());
    const fd = await open(pending, "wx", 0o600);
    try {
      await fd.writeFile(canonicalQaJson(receipt) + "\n");
      await fd.sync();
    } finally {
      await fd.close();
    }
    await link(pending, join(root, "receipts", receipt.receipt_id + ".json"));
    await unlink(pending);
    pending = null;
    return { ...receipt, replayed: false, lock_waits: waits };
  } finally {
    if (pending) await unlink(pending).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

/** Read an archived receipt without renewing its signature or payment validity. */
export async function lookupLocalQuarantineReceipt(directory, id) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
    fail("QUARANTINE_RECEIPT_ID_INVALID");
  const root = resolve(directory),
    receipts = await loadReceipts(join(root, "receipts"));
  const receipt = receipts.find((r) => r.receipt_id === id);
  if (!receipt) fail("QUARANTINE_RECEIPT_NOT_FOUND");
  return {
    ...receipt,
    lookup_only: true,
    provider_authenticated: false,
    current_evidence_validity_rechecked: false,
  };
}
