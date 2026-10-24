import { PILOT_COUNT_CODES } from "../../../lib/pilot-count-worksheet.mjs";
export const controlNow = "2026-10-24T02:00:00.000Z";
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export function controlFixture() {
  const stock = PILOT_COUNT_CODES.map((barcode: string, i: number) => ({
    barcode,
    name: "SYNTHETIC QA ONLY",
    variant_id: id(i + 1),
    location_id: "467765fe-d18e-43bb-be68-326adbf05ce1",
    observed_qty: 40,
    observed_at: "2026-10-20T14:00:00.000Z",
    physical_qty: null as number | null,
    sold_waiting_qty: null as number | null,
    separated_qty: null as number | null,
    note: "SYNTHETIC QA ONLY",
    revision: 1,
    catalog_current: true,
    balance_current: true,
    field_source_sha256: "a".repeat(64),
    field_evidence: {} as Record<string, unknown>,
  }));
  const from = "2026-10-22T18:00:00.000Z",
    until = "2026-10-22T18:10:00.000Z";
  return {
    assessedAt: controlNow,
    overview: {
      protocol: "m9-parallel-overview-1",
      read_only: true,
      operational_authorization: false,
      assembled_at: controlNow,
      inventory: { codes: 12, pending_fields: 36 },
      customers: {
        census_available: true,
        census_from: from,
        census_until: until,
        details_available: true,
        details_from: from,
        details_until: until,
        documents_reviewed: 84,
        mapped_lines: 166,
        unmapped_lines: 17,
        unconfirmed_deliveries: 183,
        registered_legacy_accounts: 114,
      },
    },
    registry: {
      protocol: "m9-legacy-registry-page-1",
      read_only: true,
      operational_import_allowed: false,
      registered: 114,
      general_archived: 53,
      total: 114,
      page: 1,
      pages: 6,
      customers: Array.from({ length: 20 }, (_, i) => ({
        id: id(i + 100),
        name: "PRIVATE_SYNTHETIC_NAME",
        phone: "PRIVATE_SYNTHETIC_PHONE",
      })),
      stock,
    },
    delivery: {
      protocol: "m9-delivery-capture-page-1",
      ready: true,
      read_only: true,
      responses_enabled: true,
      operational_import_allowed: false,
      documentary_only: true,
      stock_delivery_allowed: false,
      financial_opening_allowed: false,
      archive_sha256: "b".repeat(64),
      source_from: from,
      source_until: until,
      source_older_than_24h: true,
      summary: {
        documents: 84,
        lines: 183,
        unknown_documents: 84,
        unknown_lines: 183,
        raw_mapped_lines: 166,
        raw_unmapped_lines: 17,
        live_documentary_links: 1,
        effective_documentary_identities: 167,
        observed_documents: 0,
        concrete_documentary_reviews: 0,
        pending_documentary_reviews: 84,
      },
      total: 84,
      page: 1,
      pages: 11,
      page_size: 8,
      rows: Array.from({ length: 8 }, (_, i) => ({
        document_key: String(i + 1).padStart(64, "0"),
        customer_key: "c".repeat(64),
        client_ref: id(i + 200),
        account_name: "PRIVATE_SYNTHETIC_NAME",
        historical_name: "PRIVATE_SYNTHETIC_HISTORY",
        folio: `QA${i + 1}`,
        source_document_id: String(i + 1).padStart(24, "0"),
        source_at: from,
        source_evidence_sha256: "d".repeat(64),
        source_delivery_status: "UNKNOWN",
        documentary_statement: "UNKNOWN",
        observation_revision: 0,
        lines: [
          {
            index: 0,
            barcode: "QA_CODE",
            description: "PRIVATE_SYNTHETIC_DESCRIPTION",
            source_quantity: "1",
            generic_debt: false,
            source_delivery_status: "UNKNOWN",
            identity_kind: "ARCHIVE",
            sidecar_status: "NONE",
          },
        ],
        raw_mapped_lines: 1,
        live_documentary_links: 0,
        unresolved_identity_lines: 0,
        generic_lines: 0,
        capture_context: {
          archive_payload_hash: "e".repeat(64),
          document_snapshot_hash: "f".repeat(64),
          revision: 0,
          latest_request_id: null as null | string,
          latest_action: null as null | string,
          status: "NONE",
        },
      })),
    },
    finance: {
      accounts: Array.from({ length: 7 }, (_, i) => ({
        id: id(i + 300),
        name: "PRIVATE_SYNTHETIC_FINANCE",
        balance_cents: 219000,
        documents: 1,
        entries: [{ folio: `QAF${i + 1}`, amount_cents: 219000, due: null }],
      })),
      last_trial: null,
      trial_count: 5,
      cash_collection_enabled: false,
      staging_only: true,
    },
  };
}
export function declareFields(
  input: ReturnType<typeof controlFixture>,
  rowIndex = 0,
  quantity = 0,
) {
  const row = input.registry.stock[rowIndex];
  for (const key of [
    "physical_qty",
    "sold_waiting_qty",
    "separated_qty",
  ] as const) {
    row[key] = quantity;
    row.field_evidence[key] = {
      status: "DECLARED_CURRENT",
      actor_name: "SYNTHETIC QA ACTOR",
      declaration: {
        kind: "HUMAN_DECLARATION_NOW",
        quantity,
        source: "SYNTHETIC LOCAL COUNT ONLY",
        actor_user_id: id(999),
        declared_at: controlNow,
        captured_revision: 1,
        source_snapshot_sha256: row.field_source_sha256,
        count_certified: false,
      },
    };
  }
  input.overview.inventory.pending_fields -= 3;
}
