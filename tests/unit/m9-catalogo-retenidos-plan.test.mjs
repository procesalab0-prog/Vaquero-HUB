import { describe, it, expect } from "vitest";
import { digest } from "../../scripts/m9/acceleration.mjs";
import { prepareHeldReferences } from "../../scripts/m9/catalogo-retenidos-plan.mjs";
function fixture() {
  const source = [],
    held = [],
    refs = [],
    loaded = [];
  const groups = [
    ["DISPLAY_OR_SALES_RESTRICTION", 307],
    ["TAXONOMY_REVIEW", 76],
    ["PUBLIC_PRICE_INVALID", 39],
    ["DISPLAY_OR_SALES_RESTRICTION|TAXONOMY_REVIEW", 9],
    ["PUBLIC_PRICE_INVALID|TAXONOMY_REVIEW", 1],
    ["CATEGORY_CONFLICT", 3],
  ];
  let i = 0;
  for (const [g, n] of groups)
    for (let j = 0; j < n; j++, i++) {
      const barcode = i === 0 ? "9184" : i === 1 ? "18329" : String(20000 + i),
        reasons = g.split("|"),
        fields = {
          "clave1 *": barcode,
          "descripción *": "SYNTHETIC MODEL " + i,
          departamento: "CABALLERO",
          categoria: "PANTALONES",
          precio1:
            i === 0
              ? "1990"
              : reasons.includes("PUBLIC_PRICE_INVALID")
                ? j === 0
                  ? "0"
                  : "6299.99944"
                : "100",
        };
      const s = { barcode, description: fields["descripción *"], fields };
      source.push(s);
      held.push({ barcode, reasons });
      if (i !== 1)
        refs.push({
          barcode,
          cut_sha: "b".repeat(64),
          evidence_sha256: "c".repeat(64),
          evidence: {
            barcode,
            description: s.description,
            department: fields.departamento,
            section: fields.categoria,
            retail_source: i === 0 ? "1790" : fields.precio1,
          },
        });
    }
  for (let j = 0; j < 15961; j++) {
    const barcode = "SYNTHETIC-LOADED-" + j;
    loaded.push({ barcode });
    source.push({ barcode, fields: {} });
  }
  return {
    source,
    heldPlan: {
      version: "m9-provisional-plan-1",
      source_rows_sha256: digest(source),
      source_sha256:
        "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93",
      held,
    },
    stageCodes: loaded,
    archive: { observed_at: "2026-10-23T01:55:00Z", rows: refs },
    request_id: "00000000-0000-4000-8000-000000000001",
    source_sha256:
      "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93",
  };
}
describe("held source reference index preparer", () => {
  it("reuses433 without copies, one overlay and one new reference; never creates merchandise", () => {
    const f = fixture(),
      old = JSON.stringify(f),
      p = prepareHeldReferences(f);
    expect(p.summary.reused_without_copy).toBe(433);
    expect(p.summary.reference_count).toBe(435);
    expect(p.summary.catalog_created).toBe(0);
    expect(p.summary.variants_created).toBe(0);
    expect(p.summary.reason_counts.DISPLAY_OR_SALES_RESTRICTION).toBe(316);
    const rows = JSON.parse(p.payload.rows_json);
    expect(
      rows.filter((r) => Object.keys(r.overlay).length === 0),
    ).toHaveLength(433);
    expect(rows.find((r) => r.barcode === "9184").overlay).toEqual({
      retail_source: "1990",
    });
    expect(JSON.stringify(f)).toBe(old);
    expect(prepareHeldReferences(f)).toEqual(p);
  });
  it("separates decisions by four types, keeps raw decimal groups without rounding", () => {
    const p = prepareHeldReferences(fixture());
    expect(p.queue).toHaveLength(4);
    expect(
      p.queue.find((r) => r.reason === "DISPLAY_OR_SALES_RESTRICTION").state,
    ).toBe("POLICY_ALREADY_CONFIRMED");
    expect(
      p.queue.find((r) => r.reason === "PUBLIC_PRICE_INVALID")
        .literal_price_groups["6299.99944"],
    ).toBeGreaterThan(0);
    expect(
      p.summary.exclusive_combinations[
        "DISPLAY_OR_SALES_RESTRICTION|TAXONOMY_REVIEW"
      ],
    ).toBe(9);
  });
  it.each([
    ["wrong cut", (f) => (f.source_sha256 = "a".repeat(64))],
    ["wrong request", (f) => (f.request_id = "not-an-id")],
    ["duplicate source", (f) => f.source.push(f.source[0])],
    ["duplicate destination", (f) => f.stageCodes.push(f.stageCodes[0])],
    ["missing reason", (f) => (f.heldPlan.held[0].reasons = [])],
    ["unknown reason", (f) => (f.heldPlan.held[0].reasons = ["AUTO_APPROVED"])],
    [
      "repeated reason",
      (f) => f.heldPlan.held[0].reasons.push(f.heldPlan.held[0].reasons[0]),
    ],
    ["code changed", (f) => (f.source[0].fields["clave1 *"] = "9184 ")],
    ["description changed", (f) => (f.source[0].description += " changed")],
    ["source value missing", (f) => delete f.source[0].fields.precio1],
    ["archive duplicated", (f) => f.archive.rows.push(f.archive.rows[0])],
    ["archive hash missing", (f) => delete f.archive.rows[0].evidence_sha256],
    [
      "extra old source difference",
      (f) => (f.archive.rows[2].evidence.department = "CHANGED"),
    ],
    ["missing old reference", (f) => f.archive.rows.pop()],
    ["code now loaded", (f) => f.stageCodes.push({ barcode: "9184" })],
  ])("rejects %s", (_name, change) => {
    const f = fixture();
    change(f);
    expect(() => prepareHeldReferences(f)).toThrow();
  });
  it("preserves literal leading zeros in references and query evidence", () => {
    const f = fixture();
    const old = f.source[2].barcode,
      code = "000" + old;
    f.source[2].barcode = code;
    f.source[2].fields["clave1 *"] = code;
    f.heldPlan.held[2].barcode = code;
    const a = f.archive.rows.find((r) => r.barcode === old);
    a.barcode = code;
    a.evidence.barcode = code;
    f.heldPlan.source_rows_sha256 = digest(f.source);
    expect(
      JSON.parse(prepareHeldReferences(f).payload.rows_json).some(
        (r) => r.barcode === code,
      ),
    ).toBe(true);
  });
});
