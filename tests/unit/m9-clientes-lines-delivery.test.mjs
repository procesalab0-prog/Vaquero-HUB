import { it, expect } from "vitest";
import { digest } from "../../scripts/m9/acceleration.mjs";
import {
  prepareLinesDelivery,
  deliveryPacket,
  classifyPendingLine,
  validateDeliveryObservation,
  buildDeliveryJournalRequest,
  utc,
} from "../../scripts/m9/clientes-lines-delivery.mjs";
const now = "2026-10-22T23:45:00.000Z",
  stamp = "2026-10-22T18:00:00.000Z",
  sha = "a".repeat(64),
  ref = "11111111-1111-4111-8111-111111111111",
  vid = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const line = {
    index: 0,
    barcode: "000123",
    quantity: "1.25",
    description: "Literal talla",
    variant_id: null,
    holds: ["DELIVERY_NOT_OBSERVED"],
    delivery_status: "UNKNOWN",
    reserved_qty: null,
    stock_deduction: null,
  };
  const doc = {
    key: digest({ tenant: "VSM", client_ref: ref, folio: "VSM1" }),
    folio: "VSM1",
    source_id: "a".repeat(24),
    source_at: stamp,
    total_cents: 100,
    balance_cents: 100,
    paid_cents: 0,
    payments: [],
    lines: [line],
  };
  const account = {
    key: digest({ tenant: "VSM", client_ref: ref }),
    ref,
    name: "SYNTHETIC",
    documents: [doc],
  };
  const archive = {
    protocol: "m9-credit-detail-archive-1",
    source_plan_sha256: sha,
    source_from: stamp,
    source_until: stamp,
    operational_import_allowed: false,
    accounts: [account],
  };
  const sourceRows = [
    {
      row: 2,
      barcode: "000123",
      description: "Literal talla",
      fields: { "clave1 *": "000123" },
      classification: "SICAR_ONLY",
    },
  ];
  const snapshot = {
    protocol: "m9-exact-legacy-lines-snapshot-1",
    project_id: "zsezjtswqeijboezvado",
    archive_sha256: sha,
    captured_at: now,
    codes: [{ barcode: "000123", matches: [], managed_rows: [] }],
  };
  const packet = deliveryPacket(archive, account, doc);
  const observation = {
    archive_sha256: sha,
    document_key: doc.key,
    document_sha256: packet.document_sha256,
    reviewed_at: now,
    reviewer_ref: "SYNTHETIC REVIEWER",
    evidence_sha256: "b".repeat(64),
    statement: "ALL_DELIVERED",
    lines: [],
    documentary_only: true,
    operational_import_allowed: false,
    stock_delivery_allowed: false,
  };
  return {
    archive,
    account,
    doc,
    line,
    sourceRows,
    snapshot,
    packet,
    observation,
    assessed_at: now,
  };
}
const classify = (f) =>
  classifyPendingLine({
    line: f.line,
    document_key: f.doc.key,
    sourceRows: f.sourceRows,
    snapshot: f.snapshot,
    assessed_at: f.assessed_at,
  });
function live(f) {
  const row = { barcode: f.line.barcode, description: "Current source" };
  const m = {
    variant_id: vid,
    product_id: ref,
    active: true,
    barcode_source: "SICAR",
    primary: true,
    managed_barcode: f.line.barcode,
    managed_variant_id: vid,
    source_row: row,
    current_row: row,
  };
  f.snapshot.codes[0].matches = [m];
  f.snapshot.codes[0].managed_rows = [
    { barcode: f.line.barcode, variant_id: vid, source_row: row },
  ];
  return m;
}
it("prepares one document question without inferring paid delivery", () => {
  const f = fixture();
  f.doc.balance_cents = 0;
  f.doc.paid_cents = 100;
  const p = prepareLinesDelivery(f);
  expect(p.summary.delivery_questions).toBe(1);
  expect(p.packets[0].statement).toBe("UNKNOWN");
  expect(p.stock_delivery_allowed).toBe(false);
});
it("finds an uncatalogued exact literal without inventing a variant", () => {
  const r = classify(fixture());
  expect(r.reason).toBe("SOURCE_EXACT_AWAITING_CATALOG_IMPORT");
  expect(r.variant_id).toBeNull();
  expect(r.binding_allowed).toBe(false);
});
it("a managed live variant is only an inert binding-plan candidate", () => {
  const f = fixture();
  live(f);
  const r = classify(f);
  expect(r.reason).toBe("EXACT_LITERAL_BINDING_PLAN_CANDIDATE");
  expect(r.proposed_variant_id).toBe(vid);
  expect(r.binding_allowed).toBe(false);
  expect(r.stock_delivery_allowed).toBe(false);
});
it("never maps generic debt even if a live source mistakenly shares its code", () => {
  const f = fixture();
  f.line.barcode = "SX00000";
  f.sourceRows[0].barcode = "SX00000";
  const r = classify(f);
  expect(r.reason).toBe("GENERIC_DEBT_NOT_VARIANT");
  expect(r.physical_quantity).toBeNull();
});
it.each([
  " 000123",
  "000123 ",
  "000\n123",
  "000\u0001123",
  "000\u007f123",
  "000\u0085123",
])("retains invalid literal %s without normalizing it", (barcode) => {
  const f = fixture();
  f.line.barcode = barcode;
  const r = classify(f);
  expect(r.barcode).toBe(barcode);
  expect(r.reason).toBe("LITERAL_BARCODE_INVALID_RETAINED");
});
it("does not match codes after stripping zeros", () => {
  const f = fixture();
  f.sourceRows[0].barcode = "123";
  expect(classify(f).reason).toBe("SOURCE_BARCODE_ABSENT");
});
it("holds duplicated source code", () => {
  const f = fixture();
  f.sourceRows.push({ ...f.sourceRows[0], row: 3 });
  expect(classify(f).reason).toBe("SOURCE_BARCODE_DUPLICATE");
});
it("requires literal provenance in Clave1", () => {
  const f = fixture();
  f.sourceRows[0].fields["clave1 *"] = "123";
  expect(classify(f).reason).toBe("SOURCE_LITERAL_PROVENANCE_DIFFERS");
});
it("requires complete exact-code snapshot", () => {
  const f = fixture();
  f.snapshot.codes = [];
  expect(() => classify(f)).toThrow("EXACT_SNAPSHOT_INCOMPLETE");
});
it("holds duplicated destination matches", () => {
  const f = fixture();
  live(f);
  f.snapshot.codes[0].matches.push({ ...f.snapshot.codes[0].matches[0] });
  expect(classify(f).reason).toBe("DESTINATION_BARCODE_AMBIGUOUS");
});
it.each(["active", "primary"])("requires %s managed literal state", (key) => {
  const f = fixture();
  live(f)[key] = false;
  expect(classify(f).reason).toBe("DESTINATION_LITERAL_PROVENANCE_DIFFERS");
});
it("requires source SICAR instead of Woo/legacy aliases", () => {
  const f = fixture();
  live(f).barcode_source = "WOO";
  expect(classify(f).reason).toBe("DESTINATION_LITERAL_PROVENANCE_DIFFERS");
});
it("requires fresh destination snapshot but does not redate the archive", () => {
  const f = fixture();
  live(f);
  f.assessed_at = "2026-10-24T23:45:00.000Z";
  expect(classify(f).reason).toBe("DESTINATION_SNAPSHOT_STALE");
});
it("requires current managed row comparison", () => {
  const f = fixture();
  delete live(f).current_row;
  expect(classify(f).reason).toBe("CURRENT_MANAGED_ROW_REVIEW_REQUIRED");
});
it("does not use matching name to repair an absent literal", () => {
  const f = fixture();
  f.line.barcode = "999";
  f.snapshot.codes[0].barcode = "999";
  expect(classify(f).reason).toBe("SOURCE_BARCODE_ABSENT");
});
it.each([
  "2026-02-31T18:00:00.000Z",
  "2026-10-22T18:00:00Z",
  "2026-10-22T18:00:00.000+00:00",
  "2026-10-22T24:00:00.000Z",
])("rejects noncanonical/impossible UTC %s", (s) =>
  expect(() => utc(s)).toThrow("CANONICAL_UTC_REQUIRED"),
);
it("binds document fingerprint to cancelled payment flags", () => {
  const f = fixture();
  f.doc.payments = [{ amount_cents: 100, cancelled: true }];
  const p = deliveryPacket(f.archive, f.account, f.doc);
  expect(p.document_sha256).not.toBe(f.packet.document_sha256);
});
it("binds fingerprint to account and full source lines", () => {
  const f = fixture();
  f.doc.lines[0].description = "Changed";
  expect(deliveryPacket(f.archive, f.account, f.doc).document_sha256).not.toBe(
    f.packet.document_sha256,
  );
});
it("rejects duplicate source document instead of asking twice", () => {
  const f = fixture();
  f.account.documents.push(structuredClone(f.doc));
  expect(() => prepareLinesDelivery(f)).toThrow("DOCUMENT_IDENTITY_INVALID");
});
it("rejects invented archive stock movement", () => {
  const f = fixture();
  f.line.stock_deduction = 0;
  expect(() => prepareLinesDelivery(f)).toThrow(
    "ARCHIVE_PHYSICAL_EFFECT_FORBIDDEN",
  );
});
it("valid observation remains documentary, with no authenticated offline approver", () => {
  const f = fixture();
  const r = validateDeliveryObservation(f.packet, f.observation, now);
  expect(r.authenticated_reviewer).toBe(false);
  expect(r.stock_delivery_allowed).toBe(false);
});
it.each(["archive_sha256", "document_key", "document_sha256"])(
  "rejects stale %s",
  (key) => {
    const f = fixture();
    f.observation[key] = "f".repeat(64);
    expect(() =>
      validateDeliveryObservation(f.packet, f.observation, now),
    ).toThrow("DOCUMENT_REVISION_CHANGED");
  },
);
it("rejects missing evidence", () => {
  const f = fixture();
  delete f.observation.evidence_sha256;
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("REVIEW_EVIDENCE_REQUIRED");
});
it("rejects future review", () => {
  const f = fixture();
  f.observation.reviewed_at = "2026-10-23T00:00:00.000Z";
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("REVIEW_DATE_OUTSIDE_SOURCE_WINDOW");
});
it("rejects old observation earlier than archived source", () => {
  const f = fixture();
  f.observation.reviewed_at = "2026-10-21T00:00:00.000Z";
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("REVIEW_DATE_OUTSIDE_SOURCE_WINDOW");
});
it("rejects physical-effect opt-in", () => {
  const f = fixture();
  f.observation.stock_delivery_allowed = true;
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("OPERATIONAL_EFFECT_FORBIDDEN");
});
it("does not manufacture quantities for document-level statements", () => {
  const f = fixture();
  f.observation.lines = [{ index: 0 }];
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("DOCUMENT_STATEMENT_HAS_NO_INFERRED_LINE_QUANTITIES");
});
const mixed = (f) => {
  f.observation.statement = "MIXED";
  f.observation.lines = [
    {
      index: 0,
      barcode: "000123",
      status: "QUANTIFIED",
      delivered_qty: "0.25",
      pending_qty: "1",
    },
  ];
  return f;
};
it("preserves exact decimal mixed quantities", () => {
  const f = mixed(fixture());
  expect(
    validateDeliveryObservation(f.packet, f.observation, now).lines[0]
      .delivered_qty,
  ).toBe("0.25");
});
it("requires all document lines in mixed review", () => {
  const f = mixed(fixture());
  f.observation.lines = [];
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("MIXED_COVERAGE_INCOMPLETE");
});
it("mixed review preserves literal code including zeros", () => {
  const f = mixed(fixture());
  f.observation.lines[0].barcode = "123";
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("MIXED_LITERAL_IDENTITY_CHANGED");
});
it("rejects quantities not summing to original", () => {
  const f = mixed(fixture());
  f.observation.lines[0].pending_qty = "1.1";
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("MIXED_QUANTITIES_DIFFER");
});
it("UNKNOWN quantities are null, never zero", () => {
  const f = mixed(fixture());
  Object.assign(f.observation.lines[0], {
    status: "UNKNOWN",
    delivered_qty: "0",
    pending_qty: "0",
  });
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("UNKNOWN_IS_NOT_ZERO");
});
it("mixed generic debt cannot be quantified physically", () => {
  const f = mixed(fixture());
  f.packet.lines[0].generic_debt = true;
  expect(() =>
    validateDeliveryObservation(f.packet, f.observation, now),
  ).toThrow("GENERIC_DEBT_QUANTITY_NOT_PHYSICAL");
});
it("mixed generic debt remains UNKNOWN with null physical quantities", () => {
  const f = mixed(fixture());
  f.packet.lines[0].generic_debt = true;
  Object.assign(f.observation.lines[0], {
    status: "UNKNOWN",
    delivered_qty: null,
    pending_qty: null,
  });
  expect(
    validateDeliveryObservation(f.packet, f.observation, now)
      .stock_delivery_allowed,
  ).toBe(false);
});
it("journal request uses full immutable source, preserving nulls and no invented SQL fingerprint", () => {
  const f = fixture();
  const p = buildDeliveryJournalRequest({
    ...f,
    archive_payload_hash: sha,
    request_id: ref,
    expected_revision: 0,
  });
  expect(p.expected_document).toEqual(f.doc);
  expect(p.expected_document.lines[0].reserved_qty).toBeNull();
  expect(p.observation).not.toHaveProperty("document_sha256");
  expect(p.observation.stock_delivery_allowed).toBe(false);
});
it("journal request rejects a packet changed after review", () => {
  const f = fixture();
  f.doc.total_cents = 999;
  expect(() =>
    buildDeliveryJournalRequest({
      ...f,
      archive_payload_hash: sha,
      request_id: ref,
      expected_revision: 0,
    }),
  ).toThrow("DOCUMENT_REVISION_CHANGED");
});
it("keeps a catalog category conflict separate from absent identity", () => {
  const f = fixture();
  f.catalogPlan = {
    version: "m9-provisional-plan-1",
    production_allowed: false,
    write_allowed: false,
    inventory_operations: 0,
    held: [{ barcode: "000123", reasons: ["CATEGORY_CONFLICT"] }],
  };
  const p = prepareLinesDelivery(f);
  expect(p.pending[0].reason).toBe("SOURCE_EXACT_CATALOG_IMPORT_HELD");
  expect(p.pending[0].catalog_holds).toEqual(["CATEGORY_CONFLICT"]);
  expect(p.binding_apply_allowed).toBe(false);
});
