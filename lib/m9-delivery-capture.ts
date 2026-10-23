import {
  isDeliveryReviewPage,
  type DeliveryReviewPage,
  deliveryReviewQuery,
} from "./m9-delivery-review";
export const DELIVERY_CHOICES = [
  "ALL_PENDING",
  "ALL_DELIVERED",
  "PARTIAL_REVIEW",
  "UNKNOWN",
] as const;
export type DeliveryChoice = (typeof DELIVERY_CHOICES)[number];
export type CaptureContext = {
  archive_payload_hash: string;
  document_snapshot_hash: string;
  revision: number;
  latest_request_id: string | null;
  latest_action: "OBSERVE" | "REVOKE" | null;
  status: "NONE" | "LIVE" | "REVOKED" | "STALE";
};
export type DeliveryCapturePage = Omit<
  DeliveryReviewPage,
  "protocol" | "responses_enabled" | "rows"
> & {
  protocol: "m9-delivery-capture-page-1";
  responses_enabled: true;
  documentary_only: true;
  stock_delivery_allowed: false;
  financial_opening_allowed: false;
  rows: (DeliveryReviewPage["rows"][number] & {
    capture_context: CaptureContext;
  })[];
  summary: DeliveryReviewPage["summary"] & {
    concrete_documentary_reviews: number;
    pending_documentary_reviews: number;
  };
};
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export function isDeliveryCapturePage(v: unknown): v is DeliveryCapturePage {
  if (!v || typeof v !== "object") return false;
  const p = v as DeliveryCapturePage;
  if (
    p.protocol !== "m9-delivery-capture-page-1" ||
    p.responses_enabled !== true ||
    p.documentary_only !== true ||
    p.stock_delivery_allowed !== false ||
    p.financial_opening_allowed !== false
  )
    return false;
  if (
    !isDeliveryReviewPage({
      ...p,
      protocol: "m9-delivery-review-page-1",
      responses_enabled: false,
    })
  )
    return false;
  if (!p.ready) return true;
  return (
    hash(p.archive_sha256) &&
    Number.isSafeInteger(p.summary.concrete_documentary_reviews) &&
    p.summary.concrete_documentary_reviews >= 0 &&
    p.summary.concrete_documentary_reviews <= p.summary.documents &&
    p.summary.pending_documentary_reviews ===
      p.summary.documents - p.summary.concrete_documentary_reviews &&
    p.rows.every((d) => {
      const c = d.capture_context;
      return (
        c &&
        hash(c.archive_payload_hash) &&
        hash(c.document_snapshot_hash) &&
        Number.isSafeInteger(c.revision) &&
        c.revision >= 0 &&
        c.revision === d.observation_revision &&
        ["UNKNOWN", "ALL_PENDING", "ALL_DELIVERED", "MIXED"].includes(
          d.documentary_statement,
        ) &&
        ["NONE", "LIVE", "REVOKED", "STALE"].includes(c.status) &&
        (c.revision === 0
          ? c.status === "NONE" &&
            c.latest_request_id === null &&
            c.latest_action === null
          : uuid(c.latest_request_id) &&
            (c.status === "LIVE"
              ? c.latest_action === "OBSERVE"
              : c.status === "REVOKED"
                ? c.latest_action === "REVOKE"
                : c.status === "STALE" &&
                  ["OBSERVE", "REVOKE"].includes(c.latest_action ?? "")))
      );
    })
  );
}
export type DeliveryCaptureState = {
  status: "idle" | "saved" | "error";
  message: string;
};
export function captureRequest(form: FormData) {
  const keys = [
    "request_id",
    "archive_sha256",
    "document_key",
    "expected_archive_payload_hash",
    "expected_document_snapshot_hash",
    "expected_revision",
    "action",
    "choice",
    "revokes_request_id",
    "confirmed",
  ];
  if (keys.some((k) => form.getAll(k).length !== 1))
    throw Error("DELIVERY_CAPTURE_FORM_INVALID");
  const value = (k: string) => {
    const v = form.get(k);
    if (typeof v !== "string") throw Error("DELIVERY_CAPTURE_FORM_INVALID");
    return v;
  };
  if (
    !uuid(value("request_id")) ||
    ![
      "archive_sha256",
      "document_key",
      "expected_archive_payload_hash",
      "expected_document_snapshot_hash",
    ].every((k) => hash(value(k))) ||
    !/^(0|[1-9][0-9]{0,8})$/.test(value("expected_revision")) ||
    value("confirmed") !== "yes"
  )
    throw Error("DELIVERY_CAPTURE_FORM_INVALID");
  const action = value("action"),
    choice = value("choice"),
    revoke = value("revokes_request_id");
  if (
    action === "OBSERVE"
      ? !DELIVERY_CHOICES.includes(choice as DeliveryChoice) || revoke !== ""
      : action !== "REVOKE" || choice !== "" || !uuid(revoke)
  )
    throw Error("DELIVERY_CAPTURE_FORM_INVALID");
  return {
    protocol: "m9-delivery-capture-request-1",
    request_id: value("request_id"),
    archive_sha256: value("archive_sha256"),
    document_key: value("document_key"),
    expected_archive_payload_hash: value("expected_archive_payload_hash"),
    expected_document_snapshot_hash: value("expected_document_snapshot_hash"),
    expected_revision: Number(value("expected_revision")),
    action,
    choice: choice || null,
    revokes_request_id: revoke || null,
    confirmed: true,
  };
}
export function assertCaptureOrigin(
  origin: string | null,
  host: string | null,
) {
  if (!origin || !host || host.includes(","))
    throw Error("DELIVERY_CAPTURE_ORIGIN_INVALID");
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    throw Error("DELIVERY_CAPTURE_ORIGIN_INVALID");
  }
  if (
    u.origin !== origin ||
    u.host !== host ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname))
    )
  )
    throw Error("DELIVERY_CAPTURE_ORIGIN_INVALID");
}
export function isCaptureReceipt(
  v: unknown,
): v is { request_id: string; document_key: string } {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    r.protocol === "m9-delivery-capture-receipt-1" &&
    r.documentary_only === true &&
    r.operational_import_allowed === false &&
    r.stock_delivery_allowed === false &&
    r.financial_opening_allowed === false &&
    r.source_delivery_status === "UNKNOWN" &&
    uuid(r.request_id) &&
    hash(r.document_key) &&
    Number.isSafeInteger(r.revision)
  );
}

export function deliveryCaptureQuery(
  params: Parameters<typeof deliveryReviewQuery>[0] & {
    review_filter?: string;
  },
) {
  return {
    ...deliveryReviewQuery(params),
    review_filter: ["all", "pending", "concrete"].includes(
      params.review_filter ?? "",
    )
      ? params.review_filter!
      : "pending",
  };
}
