import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  pilotCountProgress,
  buildPilotCountWorksheet,
  renderPilotCountWorksheet,
} from "../../lib/pilot-count-worksheet.mjs";
import { preparePilotCountWorksheet } from "../../scripts/m9/prepare-pilot-count-worksheet.mjs";
const at = "2026-10-23T20:00:00.000Z";
const source = "a".repeat(64);
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const codes = [
  "2396",
  "12769",
  "11871",
  "606204203409",
  "10000",
  "10010",
  "10",
  "13988",
  "10536",
  "10055",
  "13038",
  "11920",
];
const rows = () =>
  codes.map((barcode, index) => ({
    barcode,
    name: "Synthetic QA",
    variant_id: id(index + 1),
    location_id: "467765fe-d18e-43bb-be68-326adbf05ce1",
    observed_qty: 20,
    observed_at: "2026-10-20T14:00:00.000Z",
    revision: 2,
    physical_qty: null,
    sold_waiting_qty: null,
    separated_qty: null,
    catalog_current: true,
    balance_current: true,
    field_source_sha256: source,
  }));
const metadata = {
  generated_at: at,
  source_kind: "HISTORICAL_PINNED_READ",
  source_label: "Synthetic pinned source",
};
const declaration = (quantity = 0) => ({
  status: "DECLARED_CURRENT",
  declaration: {
    kind: "HUMAN_DECLARATION_NOW",
    quantity,
    source: "Physical count QA",
    actor_user_id: id(100),
    declared_at: at,
    captured_revision: 2,
    source_snapshot_sha256: source,
    count_certified: false,
  },
});
describe("pilot worksheet reuses counts without authorizing physical operations", () => {
  it("keeps36 unknown distinct from zero and never copies SICAR reference20", () => {
    const stock = rows(),
      sheet = buildPilotCountWorksheet(stock, metadata);
    expect(sheet.progress).toMatchObject({
      required: 36,
      unknown: 36,
      declared_current: 0,
      import_allowed: false,
      count_certified: false,
    });
    expect(
      sheet.rows.every((r) =>
        Object.values(r.capture).every((c) => c.quantity === null),
      ),
    ).toBe(true);
    expect(sheet.source_quantity_semantics_confirmed).toBe(false);
    expect(stock.every((r) => r.physical_qty === null)).toBe(true);
  });
  it("accepts explicitzero only with matching current evidence; printed boxes still blank", () => {
    const stock = rows();
    stock[0].physical_qty = 0;
    stock[0].field_evidence = { physical_qty: declaration() };
    const sheet = buildPilotCountWorksheet(stock, metadata);
    expect(sheet.progress).toMatchObject({ unknown: 35, declared_current: 1 });
    expect(
      sheet.rows.find((r) => r.barcode === stock[0].barcode).capture
        .physical_qty.quantity,
    ).toBeNull();
  });
  it.each([
    "quantity",
    "source",
    "catalog",
    "balance",
    "revision",
    "actor",
    "date",
    "certified",
    "status",
  ])("retains evidence that drifts in%s", (kind) => {
    const [row] = rows();
    row.physical_qty = 0;
    row.field_evidence = { physical_qty: declaration() };
    const d = row.field_evidence.physical_qty.declaration;
    if (kind === "quantity") d.quantity = 1;
    if (kind === "source") d.source_snapshot_sha256 = "b".repeat(64);
    if (kind === "catalog") row.catalog_current = false;
    if (kind === "balance") row.balance_current = false;
    if (kind === "revision") d.captured_revision = 3;
    if (kind === "actor") d.actor_user_id = "someone";
    if (kind === "date") d.declared_at = "not a date";
    if (kind === "certified") d.count_certified = true;
    if (kind === "status")
      row.field_evidence.physical_qty.status =
        "HELD_SOURCE_OR_BASELINE_CHANGED";
    expect(pilotCountProgress([row])).toMatchObject({
      held: 1,
      declared_current: 0,
      unknown: 2,
    });
  });
  it("separates un-attributed numbers from missing quantities", () => {
    const [r] = rows();
    r.physical_qty = 0;
    expect(pilotCountProgress([r])).toMatchObject({
      unattributed: 1,
      unknown: 2,
      declared_current: 0,
    });
  });
  it.each([
    "literal",
    "duplicate",
    "variant",
    "location",
    "fraction",
    "missing",
    "extra",
  ])("rejects changedscope%s", (kind) => {
    const stock = rows();
    if (kind === "literal") stock[0].barcode = "02396";
    if (kind === "duplicate") stock[0].barcode = stock[1].barcode;
    if (kind === "variant") stock[0].variant_id = stock[1].variant_id;
    if (kind === "location") stock[0].location_id = id(200);
    if (kind === "fraction") stock[0].physical_qty = 0.5;
    if (kind === "missing") stock.pop();
    if (kind === "extra") stock.push({ ...stock[0], barcode: "999" });
    expect(() => buildPilotCountWorksheet(stock, metadata)).toThrow();
  });
  it("excludes clientPII, actors and commitments from exported display and escapes HTML", () => {
    const stock = rows();
    stock[0].name = "<script>oops</script>";
    stock[0].client_name = "PRIVATE CUSTOMER";
    stock[0].phone = "PRIVATE PHONE";
    stock[0].physical_qty = 0;
    stock[0].field_evidence = { physical_qty: declaration() };
    const sheet = buildPilotCountWorksheet(stock, metadata),
      html = renderPilotCountWorksheet(sheet);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(JSON.stringify(sheet)).not.toContain("PRIVATE");
    expect(html).not.toContain(id(100));
    expect(sheet.rows.every((r) => r.commitment_references.length === 0)).toBe(
      true,
    );
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("subconjuntos disjuntos");
  });
  it("fixes generationdate while leaving original source dates unchanged", () => {
    const sheet = buildPilotCountWorksheet(rows(), metadata);
    expect(sheet.rows[0].source_reference.observed_at).toBe(
      "2026-10-20T14:00:00.000Z",
    );
    expect(() =>
      buildPilotCountWorksheet(rows(), { ...metadata, generated_at: "now" }),
    ).toThrow();
  });
  it("rejects extra metadata instead of exporting client details or an approval claim", () => {
    expect(() =>
      buildPilotCountWorksheet(rows(), {
        ...metadata,
        customer_name: "PRIVATE",
      }),
    ).toThrow();
    expect(() =>
      buildPilotCountWorksheet(rows(), { ...metadata, approved: true }),
    ).toThrow();
  });
  it.each([
    "2026-02-31T10:00:00.000Z",
    "2026-10-23T25:00:00.000Z",
    "today",
    "2026-10-23",
    "2026-10-23T10:00:00-06:00",
  ])(
    "rejects noncanonical or impossible source/declaration date %s",
    (stamp) => {
      const stock = rows();
      stock[0].observed_at = stamp;
      expect(() => buildPilotCountWorksheet(stock, metadata)).toThrow();
      const [row] = rows();
      row.physical_qty = 0;
      row.field_evidence = { physical_qty: declaration() };
      row.field_evidence.physical_qty.declaration.declared_at = stamp;
      expect(pilotCountProgress([row])).toMatchObject({
        held: 1,
        declared_current: 0,
      });
    },
  );
  it("preserves valid PostgreSQL UTC timestamps with six-digit precision", () => {
    const stock = rows();
    stock[0].observed_at = "2026-10-20 14:45:20.697001+00";
    expect(
      buildPilotCountWorksheet(stock, metadata).rows.find(
        (r) => r.barcode === stock[0].barcode,
      ).source_reference.observed_at,
    ).toBe(stock[0].observed_at);
  });
  it("prepares twice byte-identically, rejects oldfolders and changedsource", () => {
    const dir = mkdtempSync(join(tmpdir(), "m9-count-sheet-"));
    try {
      const raw = JSON.stringify(rows()),
        input = join(dir, "rows.json"),
        config = join(dir, "config.json");
      writeFileSync(input, raw);
      writeFileSync(
        config,
        JSON.stringify({
          project_id: "zsezjtswqeijboezvado",
          mode: "READ_ONLY_BLANK_COUNT_WORKSHEET",
          metadata,
          input: {
            path: input,
            sha256: createHash("sha256").update(raw).digest("hex"),
          },
        }),
      );
      preparePilotCountWorksheet(config, join(dir, "one"));
      preparePilotCountWorksheet(config, join(dir, "two"));
      for (const name of [
        "hoja.json",
        "hoja.html",
        "resumen.json",
        "manifest.json",
      ])
        expect(readFileSync(join(dir, "one", name))).toEqual(
          readFileSync(join(dir, "two", name)),
        );
      expect(() =>
        preparePilotCountWorksheet(config, join(dir, "one")),
      ).toThrow();
      writeFileSync(input, raw + " ");
      expect(() =>
        preparePilotCountWorksheet(config, join(dir, "three")),
      ).toThrow("PILOT_WORKSHEET_INPUT_CHANGED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
