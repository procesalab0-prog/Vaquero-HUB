import { describe, it, expect } from "vitest";
import { quoteDoText } from "../../scripts/m9/sql-literal.mjs";

it("escapes source text and rejects data that can terminate a DO body", () => {
  expect(quoteDoText("O'Brien", "$m9prov$")).toBe("'O''Brien'");
  expect(() => quoteDoText("source $m9prov$;", "$m9prov$")).toThrow(
    "UNSAFE_DO_DELIMITER",
  );
});
import {
  ruleCohort,
  authorizeRule,
  activityPlan,
  digest,
} from "../../scripts/m9/acceleration.mjs";
function row(barcode, size, overrides = {}) {
  const description = "MODELOT." + size;
  const r = {
    barcode,
    description,
    classification: "SICAR_ONLY",
    issues: [],
    commercial_checks: [],
    fields: {
      "clave1 *": barcode,
      "descripción *": description,
      departamento: "CABALLERO",
      categoria: "CAMISAS",
      precio1: "740",
      "(s/n) mostrar en ventas": "s",
    },
  };
  return { ...r, ...overrides };
}
const args = (rows) => ({
  rows,
  snapshot: { codes: [], names: [] },
  taxonomy: { paths: [] },
  sourceSha: "a".repeat(64),
  seed: "fixed",
});
describe("M9 explicit rule authorization", () => {
  it("preserves leading zeros and binds every row to one rule decision", () => {
    const c = ruleCohort(args([row("0001", "S"), row("0002", "M")]));
    expect(c.summary.eligible_rows).toBe(2);
    const a = authorizeRule(
      c,
      {
        scope: "STAGING_RULE_ONLY",
        authority: "Emmanuel",
        statement: "Autorización de regla para pruebas",
        date: "2026-10-18",
      },
      {
        kind: "TECHNICAL_SOURCE_REVIEW",
        reviewer: "Codex",
        result: "PASS",
        cohort_sha256: c.cohort_sha256,
        sample_sha256: digest(c.sample),
      },
    );
    expect(a.batches.batches[0].packet.rows.map((x) => x.barcode)).toEqual([
      "0001",
      "0002",
    ]);
    expect(a.evidence.owners_confirmed_sample).toBe(false);
    expect(
      a.batches.batches[0].packet.rows.every((x) => x.cost_cents === null),
    ).toBe(true);
  });
  it.each([
    "REPEATED_SIZE",
    "PRICE_DIFFERS",
    "FOREIGN_SIBLING",
    "BAD_SUFFIX",
    "NAME_EXISTS",
    "TAXONOMY",
    "OWNER_UNSURE",
    "STAGED_MEMBER",
  ])("rejects whole family for %s", (kind) => {
    const input = args([row("1", "S"), row("2", "M")]);
    if (kind === "REPEATED_SIZE") input.rows[1] = row("2", "S");
    if (kind === "PRICE_DIFFERS") input.rows[1].fields.precio1 = "750";
    if (kind === "FOREIGN_SIBLING")
      input.rows.push(row("3", "L", { classification: "MATCHED" }));
    if (kind === "BAD_SUFFIX") input.rows.push(row("3", "XLROJO"));
    if (kind === "NAME_EXISTS") input.snapshot.names.push("MODELO");
    if (kind === "TAXONOMY")
      input.taxonomy.paths.push({ needs_review: true, barcodes: ["1"] });
    if (kind === "OWNER_UNSURE")
      input.questions = [
        {
          answers: [{ choice: "UNSURE" }],
          evidence: { members: [{ barcode: "1" }] },
        },
      ];
    if (kind === "STAGED_MEMBER") input.snapshot.codes.push({ barcode: "1" });
    // Padded base is intentionally invalid regardless of destination.
    if (kind !== "NAME_EXISTS")
      for (const r of input.rows) {
        r.description = r.description.replace("MODELO T.", "MODELOT.");
        r.fields["descripción *"] = r.description;
      }
    expect(ruleCohort(input).summary.eligible_rows).toBe(0);
  });
  it("does not infer numeric-tail sizes and excludes talla x largo", () => {
    const r = row("1", "30X32");
    r.description = "MODELOT.30X32";
    r.fields["descripción *"] = r.description;
    expect(ruleCohort(args([r])).summary.eligible_rows).toBe(0);
    r.description = "MODELO3032";
    r.fields["descripción *"] = r.description;
    expect(ruleCohort(args([r])).eligible).toEqual([]);
  });
  it("rejects absent authorization, stale sample and modified cohort", () => {
    const rows = [row("1", "S"), row("2", "M")];
    for (const r of rows) {
      r.description = r.description.replace("MODELO T.", "MODELOT.");
      r.fields["descripción *"] = r.description;
    }
    const c = ruleCohort(args(rows)),
      a = {
        scope: "STAGING_RULE_ONLY",
        authority: "Emmanuel",
        statement: "Autorización regla staging",
        date: "2026-10-18",
      };
    expect(() => authorizeRule(c, null, null)).toThrow(
      "EXPLICIT_RULE_AUTHORIZATION_REQUIRED",
    );
    expect(() => authorizeRule(c, a, {})).toThrow("SAMPLE_REVIEW_REQUIRED");
    c.eligible[0].members[0].barcode = "changed";
    expect(() => authorizeRule(c, a, {})).toThrow("COHORT_CHANGED");
  });
});
describe("M9 activity scope", () => {
  const scope = {
    cutoff: "2026-10-18",
    from: "2025-10-18",
    locations: ["A", "B"],
  };
  const reports = () =>
    Object.fromEntries(
      Object.entries({
        stock: {
          complete: true,
          cutoff: scope.cutoff,
          locations: scope.locations,
          rows: [
            { barcode: "001", location: "A", qty: 0 },
            { barcode: "001", location: "B", qty: 0 },
          ],
        },
        sales: {
          complete: true,
          all_codes: true,
          cutoff: scope.cutoff,
          from: scope.from,
          locations: scope.locations,
          rows: [],
        },
        commitments: {
          complete: true,
          all_codes: true,
          cutoff: scope.cutoff,
          locations: scope.locations,
          rows: [],
        },
      }).map(([k, v]) => [k, { ...v, code_scope_sha256: digest(["001"]) }]),
    );
  const c = { barcode: "001", inventoriable: true, open_woo_order: false };
  it("never turns missing reports into zero activity", () =>
    expect(activityPlan([c], {}, scope).rows[0].status).toBe(
      "REPORTS_REQUIRED",
    ));
  it("rejects an incomplete period and a report for a different code scope", () => {
    expect(() =>
      activityPlan([c], {}, { ...scope, from: "2026-09-18" }),
    ).toThrow("ACTIVITY_SCOPE_REQUIRED");
    const r = reports();
    r.sales.code_scope_sha256 = digest(["other"]);
    expect(activityPlan([c], r, scope).rows[0].status).toBe("REPORTS_REQUIRED");
  });
  it("only proposes archiving with complete scope and no commitments", () => {
    const p = activityPlan([c], reports(), scope);
    expect(p.rows[0].status).toBe("ARCHIVE_CANDIDATE");
    expect(p.rows[0].archive_allowed).toBe(false);
  });
  it.each([
    "NEGATIVE_STOCK",
    "OPEN_ORDER",
    "UNKNOWN_ORDER",
    "SALES_AND_RETURNS",
    "RESERVED",
    "MISSING_LOCATION",
  ])("protects %s", (kind) => {
    const r = reports(),
      code = { ...c };
    if (kind === "NEGATIVE_STOCK") r.stock.rows[0].qty = -1;
    if (kind === "OPEN_ORDER") code.open_woo_order = true;
    if (kind === "UNKNOWN_ORDER") code.open_woo_order = null;
    if (kind === "SALES_AND_RETURNS")
      r.sales.rows = [{ barcode: "001", location: "A", sold: 1, returned: 1 }];
    if (kind === "RESERVED")
      r.commitments.rows = [{ barcode: "001", location: "A", qty: 1 }];
    if (kind === "MISSING_LOCATION") r.stock.rows.pop();
    expect(activityPlan([code], r, scope).rows[0].status).not.toBe(
      "ARCHIVE_CANDIDATE",
    );
  });
});
