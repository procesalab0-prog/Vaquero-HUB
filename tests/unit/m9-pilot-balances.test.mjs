import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { digest } from "../../scripts/m9/acceleration.mjs";
import { pilotStockPreflightSQL } from "../../scripts/m9/prepare-pilot-stock.mjs";
import {
  reconcilePilotBalances,
  preparePilotBalanceReconciliation,
  pilotBalanceLedgerRehearsal,
} from "../../scripts/m9/reconcile-pilot-balances.mjs";
const at = "2026-10-20T02:30:00Z",
  project = "zsezjtswqeijboezvado",
  loc = "467765fe-d18e-43bb-be68-326adbf05ce1";
function baseFixture() {
  const p = {
    barcode: "0002396",
    variant_id: "6da4feb2-7146-4d4d-b865-6af14cc02a9b",
    product_id: "eae132eb-8111-418a-b30c-86a199934e62",
    product_name: "Sombrero <script>",
    source_description: "BASE59",
    department: "UNISEX",
    section: "SOMBRERO",
    attributes: { TALLA: "59" },
    public_price_cents: 219000,
    cost_cents: null,
    woo_product_id: 19746,
    woo_variation_id: 19815,
    source_warehouse: "default",
    source_stock_observed: "999",
    source_stock_is_importable: false,
  };
  const current = {
    barcode: p.barcode,
    description: p.source_description,
    department: p.department,
    section: p.section,
    attributes: p.attributes,
    price_cents: p.public_price_cents,
    cost_cents: null,
    product_name: p.product_name,
    woo_product_id: p.woo_product_id,
    woo_variation_id: p.woo_variation_id,
  };
  const renewal = {
    version: "m9-renewed-pilot-1",
    project_id: project,
    production_allowed: false,
    activation_allowed: false,
    inventory_import_allowed: false,
    pilot: {
      rows: [p],
      identity_sha256: digest([
        {
          barcode: p.barcode,
          variant_id: p.variant_id,
          product_id: p.product_id,
        },
      ]),
    },
  };
  const snapshot = {
    project_id: project,
    control: { enabled: true },
    captured_at: at,
    proposed_location_id: loc,
    locations: [{ id: loc, name: "La Piedad", type: "STORE", is_active: true }],
    rows: [
      {
        barcode: p.barcode,
        variant_id: p.variant_id,
        product_id: p.product_id,
        current,
        is_active: true,
        stored_matches: true,
        review_matches: true,
        barcode_matches: true,
        unit_code: "PIECE",
        location_id: loc,
        balance_present: false,
        qty: null,
        reserved_qty: null,
        movement_count: 8,
      },
    ],
  };
  return { renewal, snapshot };
}

function fixture() {
  const f = baseFixture(),
    code = "0002396";
  return {
    ...f,
    evidence: null,
    observations: [
      {
        barcode: code,
        observed_label: "ALMACENES\n\n2 PZA",
        captured_at: at,
        detail:
          '- button "0002396":\n- paragraph: BASE59\n- paragraph: $2,190.00 MXN\n- button "Almacenes 2 PZA":\n- paragraph: Default\n',
      },
    ],
    scope: {
      search: "APARTADO",
      receipt_filter: "Todos",
      terminal_list_count: 2,
      terminal_page_observed: true,
      not_a_physical_reservation_report: true,
      delivery_field_observed: false,
      unlabelled_customers_reviewed: false,
      captured_at: at,
    },
    accounts: [
      {
        client_ref: "c1",
        list_index: 0,
        unpaid: {
          folios: [],
          no_documents: true,
          empty_marker: "No hay créditos",
          captured_at: at,
        },
        paid: { folios: ["1001"], no_documents: false, captured_at: at },
      },
      {
        client_ref: "c2",
        list_index: 1,
        unpaid: { folios: ["VSM2"], no_documents: false, captured_at: at },
        paid: {
          folios: [],
          no_documents: true,
          empty_marker: "No se encontraron coincidencias",
          captured_at: at,
        },
      },
    ],
    documents: [
      {
        client_ref: "c1",
        list_index: 0,
        folio: "1001",
        financial_status: "PAID",
        warehouse: "DEFAULT",
        delivery_status: "UNKNOWN",
        captured_at: at,
        lines: [
          {
            line_index: 0,
            barcode: code,
            description: "BASE59",
            quantity: "1",
          },
        ],
      },
      {
        client_ref: "c2",
        list_index: 1,
        folio: "VSM2",
        financial_status: "OPEN",
        warehouse: "DEFAULT",
        delivery_status: "UNKNOWN",
        captured_at: at,
        lines: [
          {
            line_index: 0,
            barcode: "SX00000",
            description: "No asociar por nombre",
            quantity: "1",
          },
        ],
      },
    ],
    movements: [
      {
        barcode: code,
        folio: "1001",
        warehouse: "Default",
        movement: "Venta",
        quantity: "1",
        balance_after: "2",
        captured_at: at,
        detail: '- button "0002396":',
        table:
          "Movimiento\nUsuario\nCantidad\nSaldo\n2026\nVenta 1001\nDefault\nQA\n1\n2",
      },
    ],
  };
}
const run = (f) => reconcilePilotBalances(f, at);
it("refuses to rehearse a held code or altered parent observations", () => {
  const f = fixture();
  expect(() =>
    pilotBalanceLedgerRehearsal(f, at, JSON.stringify(f.observations)),
  ).toThrow("NO_CREDIT_FREE_QA_ROWS");
  expect(() => pilotBalanceLedgerRehearsal(f, at, "[]")).toThrow(
    "PARENT_SOURCE_OBSERVATIONS_CHANGED",
  );
});
it("derives rollback QA only from credit-free rows and never activates sales", () => {
  const f = fixture();
  f.movements = [];
  f.documents[0].lines[0].barcode = "2396";
  const tables = [
    "public.variants",
    "public.products",
    "public.barcodes",
    "public.inventory_by_location",
    "public.inventory_movements",
    "public.sales",
    "public.sale_items",
    "public.sale_payments",
    "public.cash_movements",
    "public.returns",
    "public.return_items",
    "public.return_payments",
    "app.supervisor_authorizations",
    "public.idempotency_keys",
    "public.folios",
    "public.audit_log",
    "app.m9_rehearsal_control",
    "app.m9_rehearsal_allowlist",
  ];
  f.snapshot.audit = Object.fromEntries(
    tables.map((t) => [
      t,
      { count: 0, md5: "d41d8cd98f00b204e9800998ecf8427e" },
    ]),
  );
  const sql = pilotBalanceLedgerRehearsal(
    f,
    at,
    JSON.stringify(f.observations),
  );
  expect(sql).toMatch(/rollback;\n$/);
  expect(sql).not.toMatch(/\ncommit;|update app.m9_rehearsal|disable trigger/i);
  expect(sql).toContain("M9_REVIEW_EXPIRED");
  expect(sql).toContain("Parent observation SHA256:");
});
it("separates financial status, recorded stock effect and unknown delivery", () => {
  const r = run(fixture());
  expect(r.summary).toMatchObject({
    paid_documents: 1,
    open_documents: 1,
    codes_with_credit_matches: 1,
    verified_sale_debit_lines: 1,
  });
  expect(r.credit_lines[0]).toMatchObject({
    financial_status: "PAID",
    inventory_effect: "SALE_DEBIT_OBSERVED",
    additional_stock_deduction: "0",
    delivery_status: "UNKNOWN",
    financial_import_allowed: false,
  });
  expect(r.rows[0]).toMatchObject({
    barcode: "0002396",
    source_balance_observed: "2",
    comparison_delta: "2",
    physical_qty: null,
    reserved_qty: null,
    available_qty: null,
    import_qty: null,
    import_allowed: false,
    cost_cents: null,
  });
  expect(r.rows[0].issues).toContain("MATCHED_CREDIT_DELIVERY_UNVERIFIED");
  expect(r.next_batch_candidates).toEqual([]);
  expect(r.activation_allowed).toBe(false);
  expect(r.review_questions).toHaveLength(1);
});
it("does not merge literal codes or infer zero reservations from no match", () => {
  const f = fixture();
  f.movements = [];
  f.documents[0].lines[0].barcode = "2396";
  const r = run(f);
  expect(r.summary.no_credit_match_candidates).toBe(1);
  expect(r.rows[0].reserved_qty).toBeNull();
  expect(r.next_batch_is_not_authorized).toBe(true);
  expect(
    r.credit_lines.every((l) => l.additional_stock_deduction === null),
  ).toBe(true);
});
it.each([
  (f) => f.accounts.pop(),
  (f) => (f.accounts[1].client_ref = "c1"),
  (f) => (f.accounts[1].list_index = 0),
  (f) => delete f.accounts[0].paid,
  (f) => (f.accounts[0].unpaid.empty_marker = ""),
  (f) => f.accounts[0].paid.folios.push("1001"),
  (f) =>
    (f.accounts[0].unpaid = {
      folios: ["1001"],
      no_documents: false,
      captured_at: at,
    }),
  (f) => f.documents.pop(),
  (f) => f.documents.push(f.documents[0]),
  (f) => (f.documents[0].financial_status = "OPEN"),
  (f) => (f.documents[0].warehouse = "OTHER"),
  (f) => (f.documents[0].delivery_status = "DELIVERED"),
  (f) => (f.documents[0].lines = []),
  (f) => (f.documents[0].lines[0].quantity = 1),
  (f) => (f.documents[0].lines[0].quantity = "1.5"),
  (f) => (f.documents[0].lines[0].barcode = 2396),
  (f) => (f.documents[0].lines[0].line_index = 1),
  (f) => (f.scope.delivery_field_observed = true),
  (f) => (f.scope.unlabelled_customers_reviewed = true),
  (f) => (f.scope.terminal_page_observed = false),
  (f) => (f.observations[0].captured_at = "2026-10-18T00:00:00Z"),
  (f) => (f.accounts[0].paid.captured_at = "2026-10-18T00:00:00Z"),
  (f) => (f.documents[0].captured_at = "2026-10-18T00:00:00Z"),
  (f) => (f.snapshot.project_id = "drubkjlmfbdeglucakmg"),
  (f) => (f.renewal.production_allowed = true),
  (f) =>
    (f.observations[0].detail = f.observations[0].detail.replace(
      "$2,190.00",
      "$2,290.00",
    )),
])("rejects incomplete, changed or broadened evidence", (change) => {
  const f = fixture();
  change(f);
  expect(() => run(f)).toThrow();
});
it.each([
  (f) => (f.movements[0].table = "Venta 1001 Default"),
  (f) => (f.movements[0].detail = ""),
  (f) => (f.movements[0].warehouse = "Other"),
  (f) => (f.movements[0].quantity = "2"),
  (f) => (f.movements[0].balance_after = "3"),
  (f) => f.movements.push(f.movements[0]),
  (f) => {
    f.movements[0].quantity = "2";
    f.documents[0].lines[0].quantity = "2";
  },
])(
  "does not certify a stock debit from mismatched movement evidence",
  (change) => {
    const f = fixture();
    change(f);
    expect(() => run(f)).toThrow("EXACT_SALE_MOVEMENT_REQUIRED");
  },
);
it("generates only a read-only baseline check with rollback", () => {
  const f = fixture(),
    r = run(f),
    sql = pilotStockPreflightSQL(r.stock_plan, f.snapshot);
  expect(sql).toMatch(/^begin isolation level repeatable read read only;/);
  expect(sql).toMatch(/rollback;\n$/);
  expect(sql).not.toMatch(/insert into|update public|delete from|\ncommit;/i);
  expect(sql).toContain(
    "PHYSICAL_DELIVERY_AND_UNLABELLED_COMMITMENTS_NOT_VERIFIED",
  );
});
async function diskFixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "m9-balance-unit-"));
  try {
    const data = fixture(),
      config = { assessment_at: at, inputs: {} };
    for (const [k, v] of Object.entries(data)) {
      const raw = JSON.stringify(v);
      await writeFile(join(dir, k + ".json"), raw);
      config.inputs[k] = {
        path: k + ".json",
        sha256: createHash("sha256").update(raw).digest("hex"),
      };
    }
    await writeFile(join(dir, "config.json"), JSON.stringify(config));
    await fn(dir, config);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
it("repeats byte-for-byte, escapes product HTML and keeps customer details out of the report", async () =>
  diskFixture(async (dir) => {
    await preparePilotBalanceReconciliation(
      join(dir, "config.json"),
      join(dir, "one"),
    );
    await preparePilotBalanceReconciliation(
      join(dir, "config.json"),
      join(dir, "two"),
    );
    expect(await readFile(join(dir, "one/sha256.json"), "utf8")).toBe(
      await readFile(join(dir, "two/sha256.json"), "utf8"),
    );
    const html = await readFile(join(dir, "one/reporte.html"), "utf8");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("VSM2");
    expect(html).not.toContain("<script>");
    await expect(
      preparePilotBalanceReconciliation(
        join(dir, "config.json"),
        join(dir, "one"),
      ),
    ).rejects.toThrow();
  }));
it("rejects changed input bytes before producing files", async () =>
  diskFixture(async (dir) => {
    await writeFile(join(dir, "documents.json"), "[]");
    await expect(
      preparePilotBalanceReconciliation(
        join(dir, "config.json"),
        join(dir, "out"),
      ),
    ).rejects.toThrow("BALANCE_INPUT_CHANGED:documents");
    await expect(access(join(dir, "out"))).rejects.toThrow();
  }));
