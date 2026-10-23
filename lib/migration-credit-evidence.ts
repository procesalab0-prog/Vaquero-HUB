import { createHash } from "node:crypto";

type Row = {
  key: string;
  ref: string;
  name: string;
  used_cents: number;
  holds: string[];
  documents: Array<{
    key: string;
    folio: string;
    total_cents: number;
    balance_cents: number;
  }>;
};
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v === v.trim() && !/\p{Cc}/u.test(v);
const cents = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sum = (xs: number[]) => xs.reduce((a, b) => a + BigInt(b), BigInt(0));
const stamp = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const m =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|\+00:00)$/.exec(
      v,
    );
  if (!m) return null;
  const normalized = m[1] + "." + (m[2] ?? "").padEnd(3, "0").slice(0, 3) + "Z";
  return Number.isFinite(Date.parse(normalized)) &&
    new Date(normalized).toISOString() === normalized
    ? normalized
    : null;
};

export function hasPreviousCreditDifference(a: Pick<Row, "holds">) {
  return a.holds.some((hold) =>
    ["PREVIOUS_BALANCE_CHANGED", "PREVIOUS_DOCUMENTS_CHANGED"].includes(hold),
  );
}

// A documentary match only. A null result must leave every original hold visible.
export function historicalCreditEvidence(
  a: Row,
  response: unknown,
): {
  archive: string;
  source_from: string;
  source_until: string;
} | null {
  if (
    !hasPreviousCreditDifference(a) ||
    !object(response) ||
    response.ready !== true ||
    response.historical !== true ||
    response.operational_import_allowed !== false ||
    response.total !== 1 ||
    response.page !== 1 ||
    response.pages !== 1 ||
    !Array.isArray(response.rows) ||
    response.rows.length !== 1 ||
    typeof response.archive !== "string" ||
    !/^[a-f0-9]{64}$/.test(response.archive) ||
    !object(response.summary) ||
    response.summary.archive !== response.archive ||
    response.summary.operational_import_allowed !== false ||
    !cents(response.summary.accounts) ||
    response.summary.accounts < 1 ||
    !cents(response.summary.documents) ||
    response.summary.documents < 1
  )
    return null;
  const from = stamp(response.source_from),
    until = stamp(response.source_until),
    d = response.rows[0];
  if (
    !from ||
    !until ||
    from > until ||
    !object(d) ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.ref) ||
    a.key !== hash({ client_ref: a.ref, tenant: "VSM" }) ||
    d.ref !== a.ref ||
    d.key !== a.key ||
    d.name !== a.name ||
    !cents(a.used_cents) ||
    d.balance_cents !== a.used_cents ||
    !Array.isArray(d.documents) ||
    d.documents.length > response.summary.documents
  )
    return null;
  const accountStamp = stamp(d.source_at);
  if (!accountStamp || accountStamp < from || accountStamp > until) return null;
  const dates = [accountStamp],
    keys = new Set(),
    ids = new Set(),
    payments = new Set();
  const open: Array<{
    key: string;
    folio: string;
    total_cents: number;
    balance_cents: number;
  }> = [];
  let hasPaidProof = false;
  for (const v of d.documents) {
    if (
      !object(v) ||
      !text(v.folio) ||
      v.key !== hash({ client_ref: a.ref, folio: v.folio, tenant: "VSM" }) ||
      keys.has(v.key) ||
      typeof v.source_id !== "string" ||
      !/^[a-f0-9]{24}$/.test(v.source_id) ||
      ids.has(v.source_id) ||
      !cents(v.total_cents) ||
      v.total_cents === 0 ||
      !cents(v.balance_cents) ||
      !cents(v.paid_cents) ||
      BigInt(v.total_cents) !==
        BigInt(v.balance_cents) + BigInt(v.paid_cents) ||
      typeof v.evidence_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.evidence_sha256) ||
      !Array.isArray(v.holds) ||
      v.holds.some((h: unknown) => typeof h !== "string") ||
      v.holds.includes("SOURCE_ID_CHANGED") ||
      !Array.isArray(v.payments) ||
      !Array.isArray(v.lines) ||
      v.lines.length === 0 ||
      typeof v.linked_history_complete !== "boolean"
    )
      return null;
    const date = stamp(v.source_at);
    if (!date || date < from || date > until) return null;
    dates.push(date);
    keys.add(v.key);
    ids.add(v.source_id);
    const active: number[] = [];
    for (const p of v.payments) {
      if (
        !object(p) ||
        typeof p.ref !== "string" ||
        !/^Abono [0-9]+$/.test(p.ref) ||
        p.key !== hash({ source_ref: p.ref, tenant: "VSM" }) ||
        payments.has(p.key) ||
        typeof p.evidence_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(p.evidence_sha256) ||
        typeof p.cancelled !== "boolean" ||
        !cents(p.amount_cents) ||
        p.amount_cents === 0
      )
        return null;
      payments.add(p.key);
      if (!p.cancelled) active.push(p.amount_cents);
    }
    if (
      sum(active) !== BigInt(v.paid_cents) ||
      (!v.linked_history_complete &&
        (v.paid_cents !== 0 || v.payments.length !== 0))
    )
      return null;
    if (
      v.lines.some(
        (l: unknown) =>
          !object(l) ||
          !text(l.barcode) ||
          l.delivery_status !== "UNKNOWN" ||
          l.reserved_qty !== null ||
          l.stock_deduction !== null,
      )
    )
      return null;
    if (v.balance_cents > 0)
      open.push({
        key: v.key as string,
        folio: v.folio,
        total_cents: v.total_cents,
        balance_cents: v.balance_cents,
      });
    else if (v.linked_history_complete && v.paid_cents === v.total_cents)
      hasPaidProof = true;
  }
  if (
    sum(open.map((v) => v.balance_cents)) !== BigInt(a.used_cents) ||
    a.documents.length !== open.length ||
    (a.used_cents === 0 && !hasPaidProof)
  )
    return null;
  const currentKeys = new Set();
  for (const v of a.documents) {
    if (
      !text(v.folio) ||
      v.key !== hash({ client_ref: a.ref, folio: v.folio, tenant: "VSM" }) ||
      currentKeys.has(v.key) ||
      !cents(v.total_cents) ||
      v.total_cents === 0 ||
      !cents(v.balance_cents) ||
      v.balance_cents === 0 ||
      v.balance_cents > v.total_cents ||
      !open.some(
        (d) =>
          d.key === v.key &&
          d.folio === v.folio &&
          d.total_cents === v.total_cents &&
          d.balance_cents === v.balance_cents,
      )
    )
      return null;
    currentKeys.add(v.key);
  }
  dates.sort();
  return {
    archive: response.archive,
    source_from: dates[0],
    source_until: dates.at(-1)!,
  };
}
