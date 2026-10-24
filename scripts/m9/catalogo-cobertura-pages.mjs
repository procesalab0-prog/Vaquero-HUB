import { createHash } from "node:crypto";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const needed = (ok, code) => {
  if (!ok) throw Error(code);
};
const utc = (v) => {
  if (typeof v !== "string") return false;
  const m =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(
      v,
    );
  if (!m) return false;
  const normalized = `${m[1]}T${m[2]}.${(m[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  return (
    Number.isFinite(Date.parse(normalized)) &&
    new Date(normalized).toISOString() === normalized
  );
};
export const byteOrder = (a, b) =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));
// Keep the observed source string, but compare UTC instants at PG microsecond
// precision: lexical order of accepted Z/+00:00 and fraction formats differs.
const utcOrderKey = (v) => {
  const m =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(
      v,
    );
  needed(m && utc(v), "COVERAGE_DATE_INVALID");
  return `${m[1]}.${(m[2] ?? "").padEnd(6, "0")}Z`;
};
export function decodeCoverageJSON(input) {
  if (typeof input === "string" || Buffer.isBuffer(input))
    input = JSON.parse(input.toString());
  if (!object(input) || !Array.isArray(input.content)) return input;
  needed(
    input.isError === false &&
      input.content.length === 1 &&
      input.content[0].type === "text",
    "MCP_RESULT_INVALID",
  );
  const body = JSON.parse(input.content[0].text);
  needed(typeof body.result === "string", "MCP_RESULT_MISSING");
  const block =
    /<untrusted-data-([^>]+)>\n([\s\S]*?)\n<\/untrusted-data-\1>/.exec(
      body.result,
    );
  needed(block, "MCP_RESULT_TRUNCATED");
  return JSON.parse(block[2]);
}
export function decodeCoveragePage(input) {
  const decoded = decodeCoverageJSON(input);
  const p =
    Array.isArray(decoded) && decoded.length === 1 ? decoded[0].page : null;
  needed(
    object(p) &&
      p.protocol === "m9-full-catalog-pages-1" &&
      p.project_id === "zsezjtswqeijboezvado" &&
      p.scope === "ALL_MANAGED_SICAR_ROWS_NO_CUSTOMERS" &&
      Number.isSafeInteger(p.offset) &&
      p.offset >= 0 &&
      Number.isSafeInteger(p.limit) &&
      p.limit >= 1 &&
      p.limit <= 500 &&
      Number.isSafeInteger(p.total) &&
      p.total > 0 &&
      typeof p.managed_sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(p.managed_sha256) &&
      typeof p.rows_json === "string" &&
      sha(p.rows_json) === p.rows_sha256 &&
      utc(p.observed_at),
    "COVERAGE_PAGE_INVALID_OR_TRUNCATED",
  );
  const rows = JSON.parse(p.rows_json);
  needed(
    Array.isArray(rows) &&
      rows.length === Math.min(p.limit, Math.max(0, p.total - p.offset)),
    "COVERAGE_PAGE_ROW_COUNT_CHANGED",
  );
  return { ...p, rows };
}
export function decodeCoverageAudit(input) {
  const decoded = decodeCoverageJSON(input);
  const audit =
    Array.isArray(decoded) && decoded.length === 1 ? decoded[0].audit : null;
  needed(
    Array.isArray(audit) &&
      audit.length >= 4 &&
      new Set(audit.map((r) => r.name)).size === audit.length &&
      audit.every(
        (r) =>
          object(r) &&
          typeof r.name === "string" &&
          /^(app|public)\./.test(r.name) &&
          Number.isSafeInteger(r.rows) &&
          r.rows >= 0 &&
          /^[a-f0-9]{32}$/.test(r.md5),
      ),
    "COMPLETE_TABLE_AUDIT_REQUIRED",
  );
  return audit;
}
export function assembleCatalogCoverage(pages, before, after) {
  needed(Array.isArray(pages) && pages.length > 0, "COVERAGE_PAGES_REQUIRED");
  const first = pages[0],
    count = new Map(before.map((r) => [r.name, r.rows]));
  needed(
    before.length === after.length &&
      before.every((r) =>
        after.some(
          (a) => a.name === r.name && a.rows === r.rows && a.md5 === r.md5,
        ),
      ),
    "READ_WINDOW_TABLE_DRIFT",
  );
  for (const name of [
    "app.m9_rows",
    "public.variants",
    "public.products",
    "public.barcodes",
    "public.inventory_by_location",
    "public.inventory_movements",
  ])
    needed(count.has(name), "TABLE_AUDIT_SCOPE_INCOMPLETE");
  needed(count.get("app.m9_rows") === first.total, "MANAGED_TOTAL_CHANGED");
  const ordered = [...pages].sort((a, b) => a.offset - b.offset),
    rows = [],
    codes = new Set(),
    ids = new Set();
  let offset = 0;
  for (const p of ordered) {
    needed(
      p.offset === offset &&
        p.total === first.total &&
        p.limit === first.limit &&
        p.managed_sha256 === first.managed_sha256,
      "PAGE_GAP_DUPLICATE_OR_SCOPE_DRIFT",
    );
    for (const r of p.rows) {
      needed(
        object(r) &&
          typeof r.barcode === "string" &&
          r.barcode.length > 0 &&
          r.barcode === r.barcode.trim() &&
          !/\p{Cc}/u.test(r.barcode) &&
          uuid(r.variant_id) &&
          (r.product_id === null || uuid(r.product_id)) &&
          !codes.has(r.barcode) &&
          !ids.has(r.variant_id) &&
          object(r.stored) &&
          (r.current === null || object(r.current)) &&
          /^[a-f0-9]{64}$/.test(r.source_sha256 ?? "") &&
          Number.isSafeInteger(r.barcode_binding_count) &&
          r.barcode_binding_count >= 0 &&
          Object.hasOwn(r, "native_woo_product_id") &&
          Object.hasOwn(r, "native_woo_variation_id") &&
          [r.native_woo_product_id, r.native_woo_variation_id].every(
            (v) => v === null || (Number.isSafeInteger(v) && v >= 0),
          ),
        "NON_LITERAL_DUPLICATE_OR_INCOMPLETE_NATIVE_IDENTITY",
      );
      needed(
        rows.length === 0 || byteOrder(rows.at(-1).barcode, r.barcode) < 0,
        "PAGE_ORDER_NOT_LITERAL_C",
      );
      codes.add(r.barcode);
      ids.add(r.variant_id);
      rows.push(r);
    }
    offset += p.rows.length;
  }
  needed(offset === first.total, "INCOMPLETE_CATALOG_COVERAGE");
  const dates = ordered
    .map((p) => p.observed_at)
    .sort((a, b) => byteOrder(utcOrderKey(a), utcOrderKey(b)));
  return {
    project_id: first.project_id,
    rows,
    inventory_balances: count.get("public.inventory_by_location"),
    inventory_movements: count.get("public.inventory_movements"),
    evidence_window: {
      from: dates[0],
      until: dates.at(-1),
      pages: pages.length,
      total: first.total,
      managed_sha256: first.managed_sha256,
      audited_tables: before.length,
      table_audits_equal: true,
      simultaneous_transaction: false,
    },
  };
}
