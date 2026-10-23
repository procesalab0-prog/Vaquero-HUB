export const DELIVERY_REVIEW_FILTERS = [
  "all",
  "unknown",
  "identity",
  "sidecar",
] as const;
export type DeliveryReviewFilter = (typeof DELIVERY_REVIEW_FILTERS)[number];
export type DeliveryReviewQuery = {
  q: string;
  filter: DeliveryReviewFilter;
  page: number;
  document?: string;
};
export function deliveryReviewQuery(params: {
  q?: string;
  filter?: string;
  page?: string;
  document?: string;
}): DeliveryReviewQuery {
  return {
    q: typeof params.q === "string" ? params.q.slice(0, 100) : "",
    filter: DELIVERY_REVIEW_FILTERS.includes(
      params.filter as DeliveryReviewFilter,
    )
      ? (params.filter as DeliveryReviewFilter)
      : "all",
    page: /^[1-9][0-9]{0,5}$/.test(params.page ?? "") ? Number(params.page) : 1,
    ...(/^[a-f0-9]{64}$/.test(params.document ?? "")
      ? { document: params.document }
      : {}),
  };
}
export type DeliveryReviewLine = {
  index: number;
  barcode: string;
  description: string;
  source_quantity: string;
  generic_debt: boolean;
  source_delivery_status: "UNKNOWN";
  identity_kind: "ARCHIVE" | "SIDECAR" | "UNRESOLVED";
  sidecar_status: string;
};
export type DeliveryReviewDocument = {
  document_key: string;
  customer_key: string;
  client_ref: string;
  account_name: string;
  historical_name: string;
  folio: string;
  source_document_id: string;
  source_at: string;
  source_evidence_sha256: string;
  source_delivery_status: "UNKNOWN";
  documentary_statement: string;
  observation_revision: number;
  lines: DeliveryReviewLine[];
  raw_mapped_lines: number;
  live_documentary_links: number;
  unresolved_identity_lines: number;
  generic_lines: number;
};
export type DeliveryReviewPage = {
  protocol: "m9-delivery-review-page-1";
  ready: boolean;
  read_only: true;
  responses_enabled: false;
  operational_import_allowed: false;
  archive_sha256: string;
  source_from: string;
  source_until: string;
  source_older_than_24h: boolean;
  summary: {
    documents: number;
    lines: number;
    unknown_documents: number;
    unknown_lines: number;
    raw_mapped_lines: number;
    raw_unmapped_lines: number;
    live_documentary_links: number;
    effective_documentary_identities: number;
    observed_documents: number;
  };
  total: number;
  page: number;
  pages: number;
  page_size: 8;
  rows: DeliveryReviewDocument[];
};
export function isDeliveryReviewPage(
  value: unknown,
): value is DeliveryReviewPage {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DeliveryReviewPage>;
  if (
    v.protocol !== "m9-delivery-review-page-1" ||
    v.read_only !== true ||
    v.responses_enabled !== false ||
    v.operational_import_allowed !== false
  )
    return false;
  if (v.ready === false) return true;
  const nonnegative = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (
    !v.summary ||
    ![
      v.total,
      v.summary.documents,
      v.summary.lines,
      v.summary.unknown_documents,
      v.summary.unknown_lines,
      v.summary.raw_mapped_lines,
      v.summary.raw_unmapped_lines,
      v.summary.live_documentary_links,
      v.summary.effective_documentary_identities,
      v.summary.observed_documents,
    ].every(nonnegative) ||
    v.summary.raw_mapped_lines + v.summary.raw_unmapped_lines !==
      v.summary.lines ||
    v.summary.raw_mapped_lines + v.summary.live_documentary_links !==
      v.summary.effective_documentary_identities ||
    v.summary.effective_documentary_identities > v.summary.lines ||
    v.summary.unknown_lines !== v.summary.lines ||
    v.summary.unknown_documents !== v.summary.documents
  )
    return false;
  return (
    v.ready === true &&
    v.page_size === 8 &&
    Number.isSafeInteger(v.page) &&
    Number.isSafeInteger(v.pages) &&
    (v.page ?? 0) >= 1 &&
    (v.pages ?? 0) >= (v.page ?? 0) &&
    Array.isArray(v.rows) &&
    v.rows.length <= 8 &&
    new Set(v.rows.map((d) => d?.document_key)).size === v.rows.length &&
    v.rows.every(
      (d) =>
        !!d &&
        /^[a-f0-9]{64}$/.test(d.document_key) &&
        /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(d.client_ref) &&
        d.source_delivery_status === "UNKNOWN" &&
        typeof d.account_name === "string" &&
        typeof d.folio === "string" &&
        /^[a-f0-9]{24}$/.test(d.source_document_id) &&
        /^[a-f0-9]{64}$/.test(d.source_evidence_sha256) &&
        Array.isArray(d.lines) &&
        new Set(d.lines.map((l) => l?.index)).size === d.lines.length &&
        d.lines.every(
          (l) =>
            !!l &&
            Number.isSafeInteger(l.index) &&
            l.index >= 0 &&
            typeof l.barcode === "string" &&
            l.barcode.length > 0 &&
            ["ARCHIVE", "SIDECAR", "UNRESOLVED"].includes(l.identity_kind) &&
            typeof l.generic_debt === "boolean" &&
            l.generic_debt === (l.barcode === "SX00000") &&
            typeof l.source_quantity === "string" &&
            /^[1-9][0-9]{0,8}$/.test(l.source_quantity) &&
            l.source_delivery_status === "UNKNOWN",
        ),
    )
  );
}
export function deliveryEvidenceHref(
  doc: Pick<DeliveryReviewDocument, "client_ref" | "document_key">,
) {
  if (
    !/^[a-f0-9]{64}$/.test(doc.document_key) ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(doc.client_ref)
  )
    throw Error("DELIVERY_DOCUMENT_IDENTITY_INVALID");
  return (
    "/migracion/creditos?" +
    new URLSearchParams({
      q: doc.client_ref,
      document: doc.document_key,
    }).toString() +
    "#documento-" +
    doc.document_key
  );
}
export function deliveryReviewPageHref(
  query: DeliveryReviewQuery,
  page: number,
) {
  return (
    "/migracion/entregas?" +
    new URLSearchParams({ ...query, page: String(page) }).toString() +
    "#documentos"
  );
}
