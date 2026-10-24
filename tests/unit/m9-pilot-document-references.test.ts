import { describe, it, expect } from "vitest";
import {
  loadPilotDocumentReferences,
  PILOT_DOCUMENT_PAGE_LIMIT,
} from "@/lib/m9-pilot-document-references";
import {
  buildPilotCountWorksheet,
  renderPilotCountWorksheet,
  PILOT_COUNT_CODES,
} from "@/lib/pilot-count-worksheet.mjs";
import type { DeliveryReviewPage } from "@/lib/m9-delivery-review";
const stamp = "2026-10-23T18:00:00.000Z",
  original = "2026-10-22T18:00:00.000Z";
const hash = (n: number) => n.toString(16).padStart(64, "0");
function fixture(): DeliveryReviewPage[] {
  const docs = Array.from({ length: 9 }, (_, n) => ({
    document_key: hash(n + 1),
    customer_key: hash(100 + n),
    client_ref: "11111111-1111-4111-8111-111111111111",
    account_name: "PRIVATE CUSTOMER",
    historical_name: "PRIVATE ORIGINAL",
    folio: `VSM${n + 1}`,
    source_document_id: (n + 1).toString(16).padStart(24, "0"),
    source_at: original,
    source_evidence_sha256: hash(200 + n),
    source_delivery_status: "UNKNOWN" as const,
    documentary_statement: "ALL_DELIVERED",
    observation_revision: 1,
    raw_mapped_lines: 1,
    live_documentary_links: 0,
    unresolved_identity_lines: 0,
    generic_lines: 0,
    lines: [
      {
        index: 0,
        barcode: n === 0 || n === 8 ? "2396" : "12396",
        description: "PRIVATE DESCRIPTION",
        source_quantity: "2",
        generic_debt: false,
        source_delivery_status: "UNKNOWN" as const,
        identity_kind: "ARCHIVE" as const,
        sidecar_status: "UNREVIEWED",
      },
    ],
  }));
  return [1, 2].map((page) => ({
    protocol: "m9-delivery-review-page-1",
    ready: true,
    read_only: true,
    responses_enabled: false,
    operational_import_allowed: false,
    archive_sha256: "a".repeat(64),
    source_from: original,
    source_until: original,
    source_older_than_24h: true,
    summary: {
      documents: 9,
      lines: 9,
      unknown_documents: 9,
      unknown_lines: 9,
      raw_mapped_lines: 9,
      raw_unmapped_lines: 0,
      live_documentary_links: 0,
      effective_documentary_identities: 9,
      observed_documents: 9,
    },
    total: 9,
    page,
    pages: 2,
    page_size: 8,
    rows: docs.slice((page - 1) * 8, page * 8),
  }));
}
async function readFixture(pages = fixture()) {
  return loadPilotDocumentReferences(
    async (page) => structuredClone(pages[page - 1]),
    () => stamp,
  );
}
const stock = () =>
  PILOT_COUNT_CODES.map((barcode, n) => ({
    barcode,
    name: "SYNTHETIC PRODUCT",
    variant_id: `00000000-0000-0000-0000-${String(n + 1).padStart(12, "0")}`,
    location_id: "467765fe-d18e-43bb-be68-326adbf05ce1",
    observed_qty: 3,
    observed_at: original,
    revision: 1,
    physical_qty: null,
    sold_waiting_qty: null,
    separated_qty: null,
  }));
const metadata = {
  generated_at: stamp,
  source_kind: "RPC_READ_NOW",
  source_label: "SYNTHETIC QA",
};
describe("literal archive references without physical commitments", () => {
  it("reads every page and rechecks first, keeping two exact matches and no PII", async () => {
    const calls: number[] = [],
      pages = fixture();
    const result = await loadPilotDocumentReferences(
      async (page) => {
        calls.push(page);
        return pages[page - 1];
      },
      () => stamp,
    );
    expect(calls).toEqual([1, 2, 1]);
    expect(result).toMatchObject({
      pages: 2,
      documents_scanned: 9,
      lines_scanned: 9,
      complete: true,
      current_commitments: "NOT_ASSESSED",
      operational_import_allowed: false,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.document_key)).toEqual([hash(1), hash(9)]);
    expect(
      result.rows.every(
        (r) =>
          r.source_delivery_status === "UNKNOWN" &&
          r.source_quantity === "2" &&
          r.source_at === original,
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|customer|description|ALL_DELIVERED/,
    );
    const sheet = buildPilotCountWorksheet(stock(), {
      ...metadata,
      document_references: result,
    });
    expect(
      sheet.rows.every((r: { capture: Record<string, { quantity: null }> }) =>
        Object.values(r.capture).every(
          (c: unknown) => (c as { quantity: null }).quantity === null,
        ),
      ),
    ).toBe(true);
    const html = renderPilotCountWorksheet(sheet);
    expect(html).toContain("Cantidad ORIGINAL");
    expect(html).toContain(
      `/migracion/entregas?document=${hash(1)}&amp;review_filter=all#documentos`,
    );
    expect(html).not.toMatch(/PRIVATE|ALL_DELIVERED|<form|<script/);
    expect(sheet.progress.unknown).toBe(36);
  });
  it("leaves no matches as NOT_ASSESSED, never zero commitments", async () => {
    const pages = fixture();
    for (const p of pages) for (const d of p.rows) d.lines[0].barcode = "99999";
    const refs = await readFixture(pages),
      html = renderPilotCountWorksheet(
        buildPilotCountWorksheet(stock(), {
          ...metadata,
          document_references: refs,
        }),
      );
    expect(refs.rows).toEqual([]);
    expect(html).toContain(
      "Sin coincidencia en este archivo histórico; compromisos actuales no evaluados",
    );
    expect(html).not.toContain("0 compromisos");
  });
  it.each(["archive", "summary", "interval", "total"])(
    "rejects inter-page %s drift",
    async (kind) => {
      const pages = fixture(),
        p = pages[1];
      if (kind === "archive") p.archive_sha256 = "b".repeat(64);
      if (kind === "summary") p.summary.observed_documents--;
      if (kind === "interval") p.source_until = stamp;
      if (kind === "total") p.total--;
      await expect(readFixture(pages)).rejects.toThrow();
    },
  );
  it("rejects a new archive observed by final page1 recheck", async () => {
    const pages = fixture();
    let count = 0;
    await expect(
      loadPilotDocumentReferences(
        async (page) => {
          count++;
          const result = structuredClone(pages[page - 1]);
          if (count === 3) result.archive_sha256 = "c".repeat(64);
          return result;
        },
        () => stamp,
      ),
    ).rejects.toThrow("SNAPSHOT_CHANGED");
  });
  it("rejects changed page1 rows even with identical global counts", async () => {
    const pages = fixture();
    let count = 0;
    await expect(
      loadPilotDocumentReferences(
        async (page) => {
          count++;
          const result = structuredClone(pages[page - 1]);
          if (count === 3) result.rows[0].lines[0].barcode = "10000";
          return result;
        },
        () => stamp,
      ),
    ).rejects.toThrow("SNAPSHOT_CHANGED");
  });
  it.each([
    "duplicate_doc",
    "duplicate_line",
    "missing_row",
    "wrong_page",
    "line_count",
    "source_date",
    "outside_interval",
    "folio",
    "source_state",
    "quantity",
  ])("rejects incomplete or ambiguous %s", async (kind) => {
    const pages = fixture();
    if (kind === "duplicate_doc")
      pages[1].rows[0].document_key = pages[0].rows[0].document_key;
    if (kind === "duplicate_line")
      pages[0].rows[0].lines.push({ ...pages[0].rows[0].lines[0] });
    if (kind === "missing_row") pages[1].rows = [];
    if (kind === "wrong_page") pages[1].page = 1;
    if (kind === "line_count") for (const p of pages) p.summary.lines++;
    if (kind === "source_date")
      pages[1].rows[0].source_at = "2026-02-31T18:00:00.000Z";
    if (kind === "outside_interval") pages[1].rows[0].source_at = stamp;
    if (kind === "folio")
      pages[1].rows[0].folio = '<a href="https://evil.invalid">PRIVATE</a>';
    if (kind === "source_state")
      (
        pages[1].rows[0].lines[0] as unknown as {
          source_delivery_status: string;
        }
      ).source_delivery_status = "DELIVERED";
    if (kind === "quantity") pages[1].rows[0].lines[0].source_quantity = "0";
    await expect(readFixture(pages)).rejects.toThrow();
  });
  it("enforces a hard page cap before making unbounded requests", async () => {
    const pages = fixture();
    pages[0].pages = PILOT_DOCUMENT_PAGE_LIMIT + 1;
    let calls = 0;
    await expect(
      loadPilotDocumentReferences(
        async () => {
          calls++;
          return pages[0];
        },
        () => stamp,
      ),
    ).rejects.toThrow("PAGINATION_INCOMPLETE");
    expect(calls).toBe(1);
  });
  it("rejects a failed page rather than printing a partial clean-looking list", async () => {
    const pages = fixture();
    await expect(
      loadPilotDocumentReferences(
        async (page) => {
          if (page === 2) throw Error("AUTH LOST");
          return pages[0];
        },
        () => stamp,
      ),
    ).rejects.toThrow("AUTH LOST");
  });
  it("rejects extra printable PII, duplicates and attempted approval metadata", async () => {
    const refs = await readFixture();
    for (const mutate of [
      (r: typeof refs) => Object.assign(r, { customer_name: "PRIVATE" }),
      (r: typeof refs) =>
        Object.assign(r.rows[0], { customer_name: "PRIVATE" }),
      (r: typeof refs) => r.rows.push({ ...r.rows[0] }),
      (r: typeof refs) => {
        r.operational_import_allowed = true as false;
      },
      (r: typeof refs) => {
        r.current_commitments = "ZERO" as "NOT_ASSESSED";
      },
    ]) {
      const bad = structuredClone(refs);
      mutate(bad);
      expect(() =>
        buildPilotCountWorksheet(stock(), {
          ...metadata,
          document_references: bad,
        }),
      ).toThrow();
    }
  });
  it("keeps offline worksheets without optional reference metadata backward compatible", () => {
    const sheet = buildPilotCountWorksheet(stock(), {
      ...metadata,
      source_kind: "HISTORICAL_PINNED_READ",
    });
    expect(sheet).not.toHaveProperty("document_references");
    expect(renderPilotCountWorksheet(sheet)).not.toContain(
      "Referencias documentales del archivo",
    );
  });
});
