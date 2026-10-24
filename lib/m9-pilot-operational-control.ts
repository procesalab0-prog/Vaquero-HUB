import {
  buildPilotCountWorksheet,
  pilotCountProgress,
} from "./pilot-count-worksheet.mjs";
import { physicalComparison, type LegacyPilotView } from "./legacy-pilot";
import { isDeliveryCapturePage } from "./m9-delivery-capture";
import type { LegacyFinanceView } from "./legacy-finance";

function requireValue(value: unknown, reason: string): asserts value {
  if (!value) throw Error(reason);
}
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);

// Strict UTC/PG UTC calendar roundtrip; preserve the source's original string.
function stamp(value: unknown) {
  requireValue(typeof value === "string", "PILOT_CONTROL_DATE_REQUIRED");
  const m =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(
      value,
    );
  requireValue(m, "PILOT_CONTROL_DATE_REQUIRED");
  const iso = `${m[1]}T${m[2]}.${(m[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  const time = Date.parse(iso);
  requireValue(
    Number.isFinite(time) && new Date(time).toISOString() === iso,
    "PILOT_CONTROL_DATE_INVALID",
  );
  return time;
}
function utcKey(value: unknown) {
  stamp(value);
  const m =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(
      value as string,
    )!;
  return `${m[1]}T${m[2]}.${(m[3] ?? "").padEnd(6, "0")}Z`;
}
function interval(from: unknown, until: unknown, assessedAt: string) {
  const now = stamp(assessedAt);
  const start = stamp(from);
  requireValue(
    utcKey(from) <= utcKey(until) && utcKey(until) <= utcKey(assessedAt),
    "PILOT_CONTROL_SOURCE_INTERVAL_INVALID",
  );
  return {
    from: from as string,
    until: until as string,
    older_than_24h: now - start > 86_400_000,
  };
}
function financialSummary(input: unknown) {
  const v = input as LegacyFinanceView;
  requireValue(
    v?.staging_only === true &&
      v.cash_collection_enabled === false &&
      count(v.trial_count) &&
      Array.isArray(v.accounts),
    "PILOT_CONTROL_FINANCE_NOT_EVIDENCED",
  );
  const ids = new Set<string>();
  let documents = 0;
  for (const account of v.accounts) {
    requireValue(
      uuid(account.id) &&
        !ids.has(account.id) &&
        count(account.documents) &&
        account.documents > 0 &&
        count(account.balance_cents) &&
        Array.isArray(account.entries) &&
        account.entries.length === account.documents,
      "PILOT_CONTROL_FINANCE_INCOMPLETE",
    );
    ids.add(account.id);
    const folios = new Set<string>();
    let opening = BigInt(0);
    for (const entry of account.entries) {
      requireValue(
        typeof entry.folio === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(entry.folio) &&
          !folios.has(entry.folio) &&
          count(entry.amount_cents) &&
          entry.amount_cents > 0,
        "PILOT_CONTROL_FINANCE_DOCUMENT_INVALID",
      );
      folios.add(entry.folio);
      opening += BigInt(entry.amount_cents);
    }
    requireValue(
      opening <= BigInt(Number.MAX_SAFE_INTEGER) &&
        BigInt(account.balance_cents) <= opening,
      "PILOT_CONTROL_FINANCE_AMOUNT_INVALID",
    );
    documents += account.documents;
  }
  requireValue(Number.isSafeInteger(documents), "PILOT_CONTROL_COUNT_OVERFLOW");
  // LIST is a complete SQL aggregation, without LIMIT/page metadata. Its rows
  // are the trial book only, never all current SICAR accounts or new debt.
  return {
    accounts: ids.size,
    documents,
    trial_count: v.trial_count,
    scope: "EXISTING_STAGING_TRIAL_BOOK_ONLY" as const,
    opening_eligibility: "NOT_ASSESSED" as const,
  };
}

type Overview = {
  protocol: string;
  read_only: boolean;
  operational_authorization: boolean;
  assembled_at: string;
  inventory: { codes: number; pending_fields: number };
  customers: {
    census_available: boolean;
    census_from: string | null;
    census_until: string | null;
    details_available: boolean;
    details_from: string | null;
    details_until: string | null;
    documents_reviewed: number | null;
    mapped_lines: number | null;
    unmapped_lines: number | null;
    unconfirmed_deliveries: number | null;
    registered_legacy_accounts: number;
  };
};

// Read-only eligibility of *review inputs*, not an operational opening engine.
// Financial opening remains separate: UNKNOWN delivery does not decide money.
export function pilotOperationalControl(input: {
  overview: unknown;
  registry: unknown;
  delivery: unknown;
  finance: unknown;
  assessedAt: string;
}) {
  const now = stamp(input.assessedAt),
    v = input.overview as Overview;
  requireValue(
    v?.protocol === "m9-parallel-overview-1" &&
      v.read_only === true &&
      v.operational_authorization === false,
    "PILOT_CONTROL_OVERVIEW_REQUIRED",
  );
  const assembled = stamp(v.assembled_at);
  requireValue(
    utcKey(v.assembled_at) <= utcKey(input.assessedAt) &&
      now - assembled <= 15 * 60_000,
    "PILOT_CONTROL_READING_WINDOW_EXPIRED",
  );
  const registry = input.registry as LegacyPilotView & {
    operational_import_allowed?: boolean;
  };
  requireValue(
    registry?.protocol === "m9-legacy-registry-page-1" &&
      registry.read_only === true &&
      registry.operational_import_allowed === false &&
      count(registry.registered) &&
      count(registry.total) &&
      registry.total === registry.registered &&
      registry.page === 1 &&
      registry.pages === Math.max(1, Math.ceil(registry.total / 20)) &&
      Array.isArray(registry.customers) &&
      registry.customers.length === Math.min(20, registry.total),
    "PILOT_CONTROL_REGISTRY_SCOPE_INVALID",
  );
  requireValue(
    registry.registered === v.customers.registered_legacy_accounts,
    "PILOT_CONTROL_REGISTRY_CHANGED",
  );
  // Reuse the exact existing 12-code/branch/variant/revision/quantity contract.
  buildPilotCountWorksheet(registry.stock, {
    generated_at: new Date(now).toISOString(),
    source_kind: "RPC_READ_NOW",
    source_label: "Lectores actuales; fuentes con fecha propia",
  });
  const progress = pilotCountProgress(registry.stock);
  requireValue(
    v.inventory.codes === 12 &&
      count(v.inventory.pending_fields) &&
      progress.codes === 12 &&
      progress.unknown === v.inventory.pending_fields,
    "PILOT_CONTROL_STOCK_SUMMARY_CHANGED",
  );
  let completeCodes = 0;
  for (const row of registry.stock) {
    stamp(row.observed_at);
    requireValue(
      utcKey(row.observed_at) <= utcKey(input.assessedAt),
      "PILOT_CONTROL_STOCK_SOURCE_FUTURE",
    );
    // Includes the disjoint V/S <= physically present constraint. Unknown stays
    // unknown; this comparative availability is never an import/reserve amount.
    physicalComparison(
      row.physical_qty,
      row.sold_waiting_qty,
      row.separated_qty,
    );
    if (pilotCountProgress([row]).declared_current === 3) completeCodes++;
  }
  requireValue(
    isDeliveryCapturePage(input.delivery) && input.delivery.ready,
    "PILOT_CONTROL_DELIVERY_UNAVAILABLE",
  );
  const d = input.delivery;
  requireValue(
    d.page === 1 &&
      d.total === d.summary.documents &&
      d.pages === Math.max(1, Math.ceil(d.total / 8)) &&
      d.rows.length === Math.min(8, d.total),
    "PILOT_CONTROL_DELIVERY_PARTIAL_SCOPE",
  );
  requireValue(
    v.customers.details_available === true &&
      d.source_from === v.customers.details_from &&
      d.source_until === v.customers.details_until &&
      d.summary.documents === v.customers.documents_reviewed &&
      d.summary.raw_mapped_lines === v.customers.mapped_lines &&
      d.summary.raw_unmapped_lines === v.customers.unmapped_lines &&
      d.summary.unknown_lines === v.customers.unconfirmed_deliveries,
    "PILOT_CONTROL_DOCUMENT_SOURCE_CHANGED",
  );
  const detail = interval(d.source_from, d.source_until, input.assessedAt);
  requireValue(
    d.source_older_than_24h === assembled - stamp(d.source_from) > 86_400_000,
    "PILOT_CONTROL_DETAIL_AGE_INCONSISTENT",
  );
  const census = v.customers.census_available
    ? interval(
        v.customers.census_from,
        v.customers.census_until,
        input.assessedAt,
      )
    : null;
  requireValue(
    v.customers.census_available ||
      (v.customers.census_from === null && v.customers.census_until === null),
    "PILOT_CONTROL_CENSUS_METADATA_INVALID",
  );
  requireValue(
    typeof v.customers.census_available === "boolean",
    "PILOT_CONTROL_CENSUS_METADATA_INVALID",
  );
  for (const document of d.rows)
    requireValue(
      utcKey(d.source_from) <= utcKey(document.source_at) &&
        utcKey(document.source_at) <= utcKey(d.source_until),
      "PILOT_CONTROL_DOCUMENT_DATE_OUTSIDE_ARCHIVE",
    );
  const financial = financialSummary(input.finance);
  return {
    protocol: "m9-pilot-operational-control-1" as const,
    assessed_at: input.assessedAt,
    read_only: true as const,
    independent_reads_not_simultaneous_cut: true as const,
    inventory: {
      ...progress,
      complete_codes: completeCodes,
      review_inputs_complete:
        progress.declared_current === 36 && completeCodes === 12,
      physical_status: "NOT_CERTIFIED" as const,
      import_allowed: false as const,
      source_dates: [...new Set(registry.stock.map((r) => r.observed_at))].sort(
        (a, b) => (utcKey(a) < utcKey(b) ? -1 : utcKey(a) > utcKey(b) ? 1 : 0),
      ),
    },
    delivery: {
      archive_sha256: d.archive_sha256,
      source: detail,
      documents: d.summary.documents,
      source_lines: d.summary.lines,
      source_unknown_lines: d.summary.unknown_lines,
      concrete_documentary_reviews: d.summary.concrete_documentary_reviews,
      pending_documentary_reviews: d.summary.pending_documentary_reviews,
      current_pilot_commitments: "NOT_ASSESSED" as const,
      physical_delivery: "UNKNOWN" as const,
      stock_allowed: false as const,
    },
    cuts: {
      census,
      detail,
      review_inputs_recent:
        census?.older_than_24h === false && !detail.older_than_24h,
      operating_cut_authorized: false as const,
    },
    financial,
    operational_authorization: false as const,
    stock_or_reservation_allowed: false as const,
    collect_allowed: false as const,
    global_percentage: null,
  };
}
