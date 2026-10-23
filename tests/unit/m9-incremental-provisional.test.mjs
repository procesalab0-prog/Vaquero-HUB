import { describe, it, expect } from "vitest";
import { incrementalProvisionalSql } from "../../scripts/m9/prepare-incremental-provisional-sql.mjs";
import { provisionalPlan } from "../../scripts/m9/provisional-plan.mjs";
const fields = {
  "clave1 *": "0000123",
  "descripción *": "QA ' literal",
  departamento: "QA",
  categoria: "QA",
  precio1: "7",
  unidad: "PIEZA",
  "(s/n) inventariable": "s",
  "(s/n) mostrar en ventas": "s",
  "(s/n) granel": "n",
  "(s/n) receta": "n",
  "(s/n) lotes": "n",
};
const make = () =>
  provisionalPlan({
    rows: [
      {
        barcode: fields["clave1 *"],
        description: fields["descripción *"],
        fields,
        issues: [],
      },
    ],
    snapshot: { codes: [], names: [], categories: [] },
    taxonomy: { paths: [] },
    sourceSha: "a".repeat(64),
    authorization: "Synthetic unit QA",
    date: "2026-10-22",
  });
const names = [
  "app.m9_rows",
  "app.m9_sicar_products",
  "app.m9_sicar_approved_rows",
  "app.m9_provisional_variants",
  "public.products",
  "public.variants",
  "public.barcodes",
  "public.m9_variant_details",
  "public.audit_log",
  "public.sales",
  "public.inventory_by_location",
  "public.inventory_movements",
  "public.customer_credit_ledger",
  "public.cash_movements",
];
const baseline = () =>
  names.map((name) => ({ name, rows: 8, md5: "a".repeat(32) }));
const actor = "11111111-1111-4111-8111-111111111111";
describe("incremental provisional scripts", () => {
  it("preserves nonempty history and literal leading zero code without inventory writes", () => {
    const sql = incrementalProvisionalSql(
      make(),
      baseline(),
      actor,
      "rollback",
    );
    expect(sql).toContain("0000123");
    expect(sql).toContain("QA '' literal");
    expect(sql).toContain("INCREMENTAL_PREVIOUS_ROW_CHANGED");
    expect(sql).toContain("public.products in exclusive mode");
    expect(sql).not.toContain("exists(select 1 from public.sales)");
    expect(sql).not.toMatch(
      /(?:insert into|update|delete from) public.inventory/,
    );
    expect(sql.trim().endsWith("rollback;")).toBe(true);
  });
  it("refuses production, duplicate codes, unknown modes and incomplete audit", () => {
    const p = make();
    p.production_allowed = true;
    expect(() =>
      incrementalProvisionalSql(p, baseline(), actor, "rollback"),
    ).toThrow();
    const p2 = make();
    p2.batches.batches[0].packet.rows.push(
      p2.batches.batches[0].packet.rows[0],
    );
    expect(() =>
      incrementalProvisionalSql(p2, baseline(), actor, "rollback"),
    ).toThrow();
    expect(() =>
      incrementalProvisionalSql(make(), baseline(), actor, "activate"),
    ).toThrow();
    expect(() =>
      incrementalProvisionalSql(make(), baseline().slice(1), actor, "rollback"),
    ).toThrow();
  });
  it("refuses unsafe table names, source mismatch and SQL body delimiters", () => {
    const a = baseline();
    a[0].name = "public.sales;select 1";
    expect(() =>
      incrementalProvisionalSql(make(), a, actor, "rollback"),
    ).toThrow();
    const p = make();
    p.sourceEvidence[0].fields["clave1 *"] = "123";
    expect(() =>
      incrementalProvisionalSql(p, baseline(), actor, "rollback"),
    ).toThrow();
    const p2 = make();
    p2.batches.batches[0].packet.rows[0].product_name = "$m9incremental$";
    expect(() =>
      incrementalProvisionalSql(p2, baseline(), actor, "rollback"),
    ).toThrow(/UNSAFE_DO_DELIMITER/);
  });
});
