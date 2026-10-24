import { describe, it, expect } from "vitest";
import { deliveryBatchRow, deliveryBatchScope } from "@/lib/m9-delivery-batch";
import type { DeliveryCapturePage } from "@/lib/m9-delivery-capture";
type Document = DeliveryCapturePage["rows"][number];
function document(): Document {
  return {
    document_key: "a".repeat(64),
    customer_key: "b".repeat(64),
    client_ref: "11111111-1111-4111-8111-111111111111",
    account_name: "SYNTHETIC SAME NAME",
    historical_name: "SYNTHETIC SAME NAME",
    folio: "SAME FOLIO",
    source_document_id: "c".repeat(24),
    source_at: "2026-10-22T18:00:00.000Z",
    source_evidence_sha256: "d".repeat(64),
    source_delivery_status: "UNKNOWN",
    documentary_statement: "UNKNOWN",
    observation_revision: 0,
    raw_mapped_lines: 1,
    live_documentary_links: 0,
    unresolved_identity_lines: 0,
    generic_lines: 0,
    capture_context: {
      archive_payload_hash: "e".repeat(64),
      document_snapshot_hash: "f".repeat(64),
      revision: 0,
      latest_request_id: null,
      latest_action: null,
      status: "NONE",
    },
    lines: [
      {
        index: 0,
        barcode: "000123",
        description: "SYNTHETIC PRODUCT",
        source_quantity: "9",
        generic_debt: false,
        source_delivery_status: "UNKNOWN",
        identity_kind: "ARCHIVE",
        sidecar_status: "UNREVIEWED",
      },
    ],
  };
}
describe("folio worksheet separates evidence from physical and financial eligibility", () => {
  it.each(["ALL_PENDING", "ALL_DELIVERED"])(
    "a live %s is documentary only",
    (statement) => {
      const d = document();
      d.documentary_statement = statement;
      d.capture_context.status = "LIVE";
      const before = JSON.stringify(d),
        r = deliveryBatchRow(d);
      expect(r.documentaryReview).toBe("CONCRETE");
      expect(r.sourcePhysicalStatus).toBe("UNKNOWN");
      expect(r.committedQuantity).toBeNull();
      expect(r.stockAllowed).toBe(false);
      expect(r.financialOpening).toBe("NOT_ASSESSED");
      expect(JSON.stringify(d)).toBe(before);
    },
  );
  it.each(["NONE", "REVOKED", "STALE"] as const)(
    "%s never reuses an old delivered statement as concrete",
    (status) => {
      const d = document();
      d.documentary_statement = "ALL_DELIVERED";
      d.capture_context.status = status;
      const r = deliveryBatchRow(d);
      expect(r.documentaryReview).toBe("PENDING");
      expect(r.declaration).not.toBe("Declarado todo entregado");
    },
  );
  it.each(["UNKNOWN", "MIXED"])(
    "live %s stays in documentary review",
    (statement) => {
      const d = document();
      d.capture_context.status = "LIVE";
      d.documentary_statement = statement;
      expect(deliveryBatchRow(d).documentaryReview).toBe("PENDING");
    },
  );
  it("generic debt is a line, never nine pieces or a commitment", () => {
    const d = document();
    d.lines[0].barcode = "SX00000";
    d.lines[0].generic_debt = true;
    d.lines[0].identity_kind = "UNRESOLVED";
    d.capture_context.status = "LIVE";
    d.documentary_statement = "ALL_DELIVERED";
    const r = deliveryBatchRow(d);
    expect(r.genericLines).toBe(1);
    expect(r.unresolvedLines).toBe(1);
    expect(r.documentaryReview).toBe("PENDING");
    expect(r.committedQuantity).toBeNull();
    expect(deliveryBatchScope([d])).toMatchObject({
      documents: 1,
      sourceLines: 1,
      genericLines: 1,
      physicalQuantities: null,
    });
  });
  it("counts only the current batch, preserves duplicate names/folios by document key", () => {
    const a = document(),
      b = structuredClone(a);
    b.document_key = "1".repeat(64);
    b.client_ref = "22222222-2222-4222-8222-222222222222";
    b.lines[0].identity_kind = "SIDECAR";
    const rows = [a, b];
    expect(deliveryBatchScope(rows)).toMatchObject({
      documents: 2,
      sourceLines: 2,
      physicalQuantities: null,
    });
    expect(rows.map(deliveryBatchRow).map((r) => r.documentKey)).toEqual([
      a.document_key,
      b.document_key,
    ]);
    expect(deliveryBatchRow(b).unresolvedLines).toBe(0);
  });
});
