import {
  isDeliveryReviewPage,
  type DeliveryReviewPage,
} from "./m9-delivery-review";
import { PILOT_COUNT_CODES } from "./pilot-count-worksheet.mjs";

export const PILOT_DOCUMENT_PAGE_LIMIT = 20;
export type PilotDocumentReferences = {
  protocol: "m9-pilot-document-references-1";
  archive_sha256: string;
  source_from: string;
  source_until: string;
  read_from: string;
  read_until: string;
  pages: number;
  documents_scanned: number;
  lines_scanned: number;
  scope_codes: string[];
  complete: true;
  current_commitments: "NOT_ASSESSED";
  operational_import_allowed: false;
  rows: {
    barcode: string;
    document_key: string;
    line_index: number;
    folio: string;
    source_at: string;
    source_quantity: string;
    source_evidence_sha256: string;
    source_delivery_status: "UNKNOWN";
  }[];
};
const needed = (ok: unknown, reason: string): void => {
  if (!ok) throw Error(reason);
};
const date = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  const m =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(
      v,
    );
  if (!m) return false;
  const canonical = `${m[1]}T${m[2]}.${(m[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  return (
    Number.isFinite(Date.parse(canonical)) &&
    new Date(canonical).toISOString() === canonical
  );
};
const stable = (v: unknown): string =>
  JSON.stringify(
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, JSON.parse(stable(x))]),
        )
      : Array.isArray(v)
        ? v.map((x) => JSON.parse(stable(x)))
        : v,
  );
const context = (p: DeliveryReviewPage) =>
  stable({
    archive: p.archive_sha256,
    from: p.source_from,
    until: p.source_until,
    total: p.total,
    pages: p.pages,
    page_size: p.page_size,
    summary: p.summary,
  });
function checked(value: unknown, page: number): DeliveryReviewPage {
  needed(
    isDeliveryReviewPage(value) && value.ready,
    "PILOT_DOCUMENT_READ_UNAVAILABLE",
  );
  const p = value as DeliveryReviewPage;
  needed(
    /^[a-f0-9]{64}$/.test(p.archive_sha256) &&
      date(p.source_from) &&
      date(p.source_until) &&
      Date.parse(p.source_from) <= Date.parse(p.source_until),
    "PILOT_DOCUMENT_SOURCE_INVALID",
  );
  needed(
    p.page === page &&
      p.pages <= PILOT_DOCUMENT_PAGE_LIMIT &&
      p.pages === Math.max(1, Math.ceil(p.total / 8)) &&
      p.total === p.summary.documents &&
      p.rows.length === Math.max(0, Math.min(8, p.total - (page - 1) * 8)),
    "PILOT_DOCUMENT_PAGINATION_INCOMPLETE",
  );
  return p;
}

// Read only when a user explicitly opens the printable worksheet. Each RPC is a
// distinct snapshot: pin metadata, check every page, then re-read page1. This is
// an interval observation, never a transaction or a proof of current commitments.
export async function loadPilotDocumentReferences(
  read: (page: number) => Promise<unknown>,
  now: () => string = () => new Date().toISOString(),
): Promise<PilotDocumentReferences> {
  const readFrom = now();
  needed(date(readFrom), "PILOT_DOCUMENT_READ_TIME_INVALID");
  const first = checked(await read(1), 1),
    baseline = context(first);
  const pages = [first];
  for (let start = 2; start <= first.pages; start += 3) {
    const group = Array.from(
      { length: Math.min(3, first.pages - start + 1) },
      (_, i) => start + i,
    );
    const replies = await Promise.all(
      group.map(async (page) => checked(await read(page), page)),
    );
    for (const p of replies) {
      needed(context(p) === baseline, "PILOT_DOCUMENT_SNAPSHOT_CHANGED");
      pages.push(p);
    }
  }
  const last = checked(await read(1), 1);
  needed(
    context(last) === baseline && stable(last.rows) === stable(first.rows),
    "PILOT_DOCUMENT_SNAPSHOT_CHANGED",
  );
  const readUntil = now();
  needed(
    date(readUntil) && Date.parse(readUntil) >= Date.parse(readFrom),
    "PILOT_DOCUMENT_READ_TIME_INVALID",
  );
  const seen = new Set<string>(),
    rows: PilotDocumentReferences["rows"] = [];
  let lines = 0;
  for (const page of pages)
    for (const doc of page.rows) {
      needed(
        !seen.has(doc.document_key) &&
          date(doc.source_at) &&
          Date.parse(doc.source_at) >= Date.parse(first.source_from) &&
          Date.parse(doc.source_at) <= Date.parse(first.source_until),
        "PILOT_DOCUMENT_IDENTITY_INVALID",
      );
      seen.add(doc.document_key);
      for (const line of doc.lines) {
        lines++;
        if (!PILOT_COUNT_CODES.includes(line.barcode)) continue;
        needed(
          /^(?:[A-Z]{1,8}-?)?[0-9]{1,16}$/.test(doc.folio),
          "PILOT_DOCUMENT_FOLIO_INVALID",
        );
        // Deliberately omit customer refs/names, descriptions, balances, payments,
        // current declaration authors and all source quantity interpretations.
        rows.push({
          barcode: line.barcode,
          document_key: doc.document_key,
          line_index: line.index,
          folio: doc.folio,
          source_at: doc.source_at,
          source_quantity: line.source_quantity,
          source_evidence_sha256: doc.source_evidence_sha256,
          source_delivery_status: "UNKNOWN",
        });
      }
    }
  needed(
    seen.size === first.total && lines === first.summary.lines,
    "PILOT_DOCUMENT_SCOPE_INCOMPLETE",
  );
  rows.sort(
    (a, b) =>
      a.barcode.localeCompare(b.barcode, "en") ||
      a.document_key.localeCompare(b.document_key) ||
      a.line_index - b.line_index,
  );
  return {
    protocol: "m9-pilot-document-references-1",
    archive_sha256: first.archive_sha256,
    source_from: first.source_from,
    source_until: first.source_until,
    read_from: readFrom,
    read_until: readUntil,
    pages: first.pages,
    documents_scanned: seen.size,
    lines_scanned: lines,
    scope_codes: [...PILOT_COUNT_CODES],
    complete: true,
    current_commitments: "NOT_ASSESSED",
    operational_import_allowed: false,
    rows,
  };
}
