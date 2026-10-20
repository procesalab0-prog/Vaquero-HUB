import { it, expect } from "vitest";
import { digest } from "../../scripts/m9/acceleration.mjs";
import { reviewPilotEvidence } from "../../scripts/m9/review-sicar-pilot-evidence.mjs";

function fixture() {
  const p = {
    barcode: "0002396",
    variant_id: "v1",
    product_id: "p1",
    source_description: "BASE59",
    product_name: "Sombrero",
    attributes: { TALLA: "59" },
    public_price_cents: 219000,
    source_stock_observed: "2",
  };
  return {
    renewal: {
      version: "m9-renewed-pilot-1",
      project_id: "zsezjtswqeijboezvado",
      production_allowed: false,
      inventory_import_allowed: false,
      pilot: {
        identity_sha256: digest([
          {
            barcode: p.barcode,
            variant_id: p.variant_id,
            product_id: p.product_id,
          },
        ]),
        rows: [p],
      },
    },
    observations: [
      {
        barcode: p.barcode,
        observed_label: "ALMACENES\n\n2 PZA",
        captured_at: "2026-10-20T02:39:00Z",
        detail:
          '- button "0002396":\n- paragraph: BASE59\n- paragraph: $2,190.00 MXN\n- button "Almacenes 2 PZA":\n- paragraph: Default\n',
      },
    ],
    clients: [
      {
        client_ref: "c1",
        list_index: 0,
        filter: "No pagado / recepción Todos",
        folios: ["VSM1"],
        no_documents: false,
      },
      {
        client_ref: "c2",
        list_index: 1,
        filter: "No pagado / recepción Todos",
        folios: [],
        no_documents: true,
      },
    ],
    documents: [
      {
        client_ref: "c1",
        folio: "VSM1",
        warehouse: "DEFAULT",
        lines: [
          { barcode: "SX00000", description: "Producto manual", quantity: "1" },
          {
            barcode: "2396",
            description: "Otro código sin ceros",
            quantity: "1",
          },
        ],
      },
    ],
    scope: {
      search: "APARTADO",
      filter: "No pagado / recepción Todos",
      terminal_list_count: 2,
      terminal_page_observed: true,
    },
  };
}
const run = (f) =>
  reviewPilotEvidence(
    f.renewal,
    f.observations,
    f.clients,
    f.documents,
    f.scope,
  );
it("does not turn a complete financial crosscheck without matches into zero reservations", () => {
  const r = run(fixture());
  expect(r.summary).toMatchObject({
    codes: 1,
    source_units_observed: 2,
    clients_reviewed: 2,
    pending_credit_documents: 1,
    pilot_codes_with_credit_matches: 0,
  });
  expect(r.rows[0]).toMatchObject({
    barcode: "0002396",
    reserved_qty: null,
    physical_qty: null,
    available_qty: null,
    import_allowed: false,
    cost_cents: null,
  });
  expect(r.no_match_does_not_authorize_zero_reservations).toBe(true);
  expect(r.scope.paid_documents_reviewed).toBe(false);
  expect(r.inventory_import_allowed).toBe(false);
});
it("matches literal barcodes, preserves line quantities, and never subtracts a credit twice", () => {
  const f = fixture();
  f.documents[0].lines.push(
    { barcode: "0002396", description: "BASE59", quantity: "1" },
    { barcode: "0002396", description: "BASE59", quantity: "2" },
  );
  const r = run(f);
  expect(r.rows[0].pending_credit_matches).toHaveLength(2);
  expect(r.rows[0].matched_credit_quantity).toBe("3");
  expect(r.rows[0].observed_source_qty).toBe("2");
  expect(r.rows[0].reserved_qty).toBe(null);
});
it("does not associate shared manual codes with the pilot by product name", () => {
  const f = fixture();
  f.documents[0].lines[0].description = "BASE59";
  expect(run(f).summary.pilot_codes_with_credit_matches).toBe(0);
});
it.each([
  (f) => f.clients.pop(),
  (f) => (f.scope.terminal_page_observed = false),
  (f) => (f.scope.search = ""),
  (f) => (f.clients[1].list_index = 0),
])("requires every client in the stated search scope", (change) => {
  const f = fixture();
  change(f);
  expect(() => run(f)).toThrow("EXACT_SCOPED_CLIENT_COVERAGE_REQUIRED");
});
it("requires detail for every listed pending document", () => {
  const f = fixture();
  f.documents = [];
  expect(() => run(f)).toThrow("PENDING_DOCUMENT_NOT_REVIEWED");
});
it.each([
  (f) => (f.documents[0].lines = []),
  (f) => (f.documents[0].warehouse = "OTHER"),
  (f) => (f.documents[0].lines[0].barcode = 2396),
  (f) => (f.documents[0].lines[0].quantity = "1.5"),
  (f) => f.documents.push(f.documents[0]),
])("rejects partial, ambiguous or duplicate document evidence", (change) => {
  const f = fixture();
  change(f);
  expect(() => run(f)).toThrow("DOCUMENT_DETAIL_REQUIRED");
});
it("requires explicit empty-document observations rather than a zero balance assumption", () => {
  const f = fixture();
  delete f.clients[1].no_documents;
  expect(() => run(f)).toThrow("INCOMPLETE_OR_DUPLICATE_CLIENT_REVIEW");
});
it.each([
  (f) => (f.observations[0].barcode = 2396),
  (f) => f.observations.push(f.observations[0]),
])("rejects numeric/duplicate observation codes", (change) => {
  const f = fixture();
  change(f);
  expect(() => run(f)).toThrow("DUPLICATE_OR_NONLITERAL_OBSERVATION");
});
it.each([
  (f) =>
    (f.observations[0].detail = f.observations[0].detail.replace(
      "BASE59",
      "BASE58",
    )),
  (f) => (f.observations[0].observed_label = "ALMACENES 2.5 PZA"),
  (f) => (f.observations[0].detail += "- paragraph: Default\n"),
])("requires literal identity and one observed Default warehouse", (change) => {
  const f = fixture();
  change(f);
  expect(() => run(f)).toThrow("SOURCE_DETAIL_SCOPE_OR_IDENTITY_CHANGED");
});
it("rejects a live price change", () => {
  const f = fixture();
  f.observations[0].detail = f.observations[0].detail.replace(
    "2,190.00",
    "2,200.00",
  );
  expect(() => run(f)).toThrow("SOURCE_PRICE_CHANGED");
});
it("reports stock changes without treating them as approval", () => {
  const f = fixture();
  f.renewal.pilot.rows[0].source_stock_observed = "1";
  expect(run(f).summary.changed_since_export).toBe(1);
  expect(run(f).rows[0].import_allowed).toBe(false);
});
it("rejects expanded production context", () => {
  const f = fixture();
  f.renewal.production_allowed = true;
  expect(() => run(f)).toThrow("RENEWED_READ_ONLY_PILOT_REQUIRED");
});
