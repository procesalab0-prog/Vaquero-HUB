export const HELD_REASON_LABELS = {
  DISPLAY_OR_SALES_RESTRICTION: "Exhibición o venta restringida",
  TAXONOMY_REVIEW: "Departamento o sección por revisar",
  PUBLIC_PRICE_INVALID: "Precio1 por revisar",
  CATEGORY_CONFLICT: "Sección en conflicto",
} as const;
export type HeldReason = keyof typeof HELD_REASON_LABELS;
export type HeldQuery = {
  q: string;
  exact: boolean;
  reason: HeldReason | "ALL";
  page: number;
};
export function heldReferenceQuery(
  p: Record<string, string | string[] | undefined>,
): HeldQuery {
  const text = (k: string) => {
    if (p[k] === undefined) return "";
    if (typeof p[k] !== "string") throw Error("HELD_FILTER_INVALID");
    return p[k] as string;
  };
  const q = text("q"),
    mode = text("mode") || "text",
    reason = text("reason") || "ALL",
    page = text("page") || "1";
  if (
    q.length > 160 ||
    !["exact", "text"].includes(mode) ||
    (reason !== "ALL" && !Object.hasOwn(HELD_REASON_LABELS, reason)) ||
    !/^[1-9][0-9]{0,4}$/.test(page)
  )
    throw Error("HELD_FILTER_INVALID");
  return {
    q,
    exact: mode === "exact",
    reason: reason as HeldReason | "ALL",
    page: Number(page),
  };
}
export function heldReferenceHref(
  q: HeldQuery,
  page = q.page,
  reason = q.reason,
) {
  return (
    "/migracion/retenidos?" +
    new URLSearchParams({
      q: q.q,
      mode: q.exact ? "exact" : "text",
      reason,
      page: String(page),
    })
  );
}
export type HeldReferenceRow = {
  barcode: string;
  reasons: HeldReason[];
  display_restricted: boolean;
  origin_cut_sha: string | null;
  origin_intact: boolean;
  projection: {
    description: string;
    department: string;
    section: string;
    retail_source: string;
  } | null;
  catalog_now_present: boolean;
  sell_allowed: false;
  stock_allowed: false;
  woo_allowed: false;
};
export type HeldReferenceView = {
  protocol: "m9-held-reference-read-1";
  ready: boolean;
  write_allowed: false;
  operational_authorization: false;
  source_date: string;
  source_sha256: string;
  archived_at: string;
  total_references: number;
  reason_counts: Record<HeldReason, number>;
  total: number;
  page: number;
  page_size: 20;
  current_catalog_overlap: number;
  origin_changed: number;
  price_subgroups: { extra_decimals: number; zero: number };
  examples: Record<
    HeldReason,
    {
      barcode: string;
      description: string | null;
      retail_source: string | null;
    }[]
  >;
  rows: HeldReferenceRow[];
};
export function isHeldReferenceView(
  value: unknown,
): value is HeldReferenceView {
  if (!value || typeof value !== "object") return false;
  const v = value as HeldReferenceView;
  if (
    v.protocol !== "m9-held-reference-read-1" ||
    v.write_allowed !== false ||
    v.operational_authorization !== false
  )
    return false;
  if (v.ready === false) return true;
  const n = (x: unknown) =>
    typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
  if (
    v.ready !== true ||
    v.total_references !== 435 ||
    v.page_size !== 20 ||
    !n(v.total) ||
    v.total > 435 ||
    !n(v.page) ||
    v.page < 1 ||
    !n(v.current_catalog_overlap) ||
    v.current_catalog_overlap > 435 ||
    !n(v.origin_changed) ||
    v.origin_changed > 435 ||
    !v.reason_counts ||
    !v.examples ||
    !v.price_subgroups ||
    !n(v.price_subgroups.extra_decimals) ||
    !n(v.price_subgroups.zero) ||
    v.price_subgroups.extra_decimals + v.price_subgroups.zero >
      v.reason_counts.PUBLIC_PRICE_INVALID ||
    !/^[a-f0-9]{64}$/.test(v.source_sha256) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.source_date) ||
    !Number.isFinite(Date.parse(v.archived_at))
  )
    return false;
  if (
    !Object.keys(HELD_REASON_LABELS).every(
      (k) =>
        n(v.reason_counts[k as HeldReason]) &&
        v.reason_counts[k as HeldReason] <= 435 &&
        Array.isArray(v.examples[k as HeldReason]) &&
        v.examples[k as HeldReason].length <= 2 &&
        v.examples[k as HeldReason].every(
          (e) =>
            typeof e.barcode === "string" &&
            [e.description, e.retail_source].every(
              (x) => x === null || typeof x === "string",
            ),
        ),
    )
  )
    return false;
  return (
    Array.isArray(v.rows) &&
    v.rows.length <= 20 &&
    new Set(v.rows.map((r) => r.barcode)).size === v.rows.length &&
    v.rows.every(
      (r) =>
        !!r &&
        typeof r.barcode === "string" &&
        r.barcode.length > 0 &&
        Array.isArray(r.reasons) &&
        r.reasons.length > 0 &&
        new Set(r.reasons).size === r.reasons.length &&
        r.reasons.every((x) => Object.hasOwn(HELD_REASON_LABELS, x)) &&
        r.display_restricted ===
          r.reasons.includes("DISPLAY_OR_SALES_RESTRICTION") &&
        typeof r.catalog_now_present === "boolean" &&
        typeof r.origin_intact === "boolean" &&
        r.sell_allowed === false &&
        r.stock_allowed === false &&
        r.woo_allowed === false &&
        (r.origin_intact
          ? !!r.projection &&
            Object.keys(r.projection).length === 4 &&
            ["description", "department", "section", "retail_source"].every(
              (k) =>
                typeof r.projection?.[
                  k as keyof NonNullable<HeldReferenceRow["projection"]>
                ] === "string",
            )
          : r.projection === null),
    )
  );
}
