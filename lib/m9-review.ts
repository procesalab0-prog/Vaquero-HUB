export type ReviewFilters = {
  q: string;
  exact: boolean;
  department: string;
  section: string;
  page: number;
};
export type ReviewRow = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  department: string;
  section: string;
  source_description: string;
  price_cents: number;
  cost_cents: number | null;
  wholesale_cents: number | null;
  medium_wholesale_cents: number | null;
  woo_product_id: number;
  woo_variation_id: number | null;
  is_active: boolean;
  attributes: Record<string, string>;
};
export type ReviewData = {
  rows: ReviewRow[];
  total: number;
  page: number;
  page_size: number;
  can_view_cost: boolean;
  departments: string[];
  sections: string[];
};

export function reviewFilters(
  params: Record<string, string | string[] | undefined>,
): ReviewFilters {
  const get = (key: string) =>
    typeof params[key] === "string" ? params[key] : "";
  const q = get("q"),
    department = get("department"),
    section = get("section");
  const page = get("page") || "1";
  if (
    [q, department, section].some((v) => v.length > 160) ||
    !/^[1-9]\d{0,5}$/.test(page) ||
    Number(page) > 100000
  ) {
    throw new Error("INVALID_REVIEW_FILTER");
  }
  // Barcode is deliberately not trimmed, normalized or coerced to a number.
  return {
    q,
    exact: get("mode") === "exact",
    department,
    section,
    page: Number(page),
  };
}
export function reviewHref(filters: ReviewFilters, page: number) {
  return (
    "/productos/migracion?" +
    new URLSearchParams({
      q: filters.q,
      mode: filters.exact ? "exact" : "text",
      department: filters.department,
      section: filters.section,
      page: String(page),
    })
  );
}
export function reviewMoney(cents: number | null, missing: string) {
  return cents === null
    ? missing
    : new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
      }).format(cents / 100);
}
