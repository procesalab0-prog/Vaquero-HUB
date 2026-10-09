import { expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  coverageReview,
  coverageHtml,
  prepareCoverageReview,
} from "../../scripts/m9/prepare-coverage-review.mjs";
import {
  planSicarOnly,
  prepareSicarBatches,
} from "../../scripts/m9/plan-sicar-only.mjs";
function fixture() {
  const row = (code, description, classification = "SICAR_ONLY") => ({
    barcode: code,
    description,
    classification,
    issues: [],
    commercial_checks: [],
    product_id: null,
    variation_id: null,
    candidate_product_ids: [],
    attributes: [],
    fields: {
      "clave1 *": code,
      "descripción *": description,
      departamento: "NIÑO",
      categoria: "CAMISAS",
      precio1: "740.00",
      "(s/n) mostrar en ventas": "s",
    },
  });
  const rows = [
    row("0001", "EXISTM", "MATCH_EXACT_VARIANT"),
    row("2", "AT.S"),
    row("3", "AT.M"),
    row("4", "AT.L"),
    row("5", "BT.S"),
    row("6", "BT.M"),
  ];
  Object.assign(rows[0], {
    product_id: 10,
    variation_id: 11,
    attributes: [{ name: "Talla", value: "M" }],
  });
  const current = {
    barcode: "0001",
    description: "EXISTM",
    department: "NIÑO",
    section: "CAMISAS",
    price_cents: 74000,
    cost_cents: null,
    product_name: "Existing",
    attributes: { TALLA: "M" },
    woo_product_id: 10,
    woo_variation_id: 11,
  };
  return {
    rows,
    applied: structuredClone(rows),
    taxonomy: { paths: [] },
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      inventory_balances: 0,
      inventory_movements: 0,
      products: [{ id: "parent", name: "Existing" }],
      rows: [
        {
          variant_id: "variant",
          product_id: "parent",
          current,
          stored: structuredClone(current),
        },
      ],
    },
  };
}
const run = (f, target = 50) =>
  coverageReview(f.rows, f.applied, f.snapshot, f.taxonomy, target);
it("uses a strict threshold, whole families and deterministic minimum case count without approval", () => {
  const f = fixture(),
    before = structuredClone(f),
    p = run(f);
  expect(p.summary.additional_rows_required).toBe(3);
  expect(p.summary.priority_rows).toBe(3);
  expect(p.summary.maximum_rows_with_one_fewer_priority_cases).toBeLessThan(
    p.summary.additional_rows_required,
  );
  expect(p.priority.map((c) => c.product_name_proposed)).toEqual(["A"]);
  expect(p.summary.projected_coverage_percent).toBeGreaterThan(50);
  expect(p.summary.imported_new_rows).toBe(0);
  expect(
    p.templates.every((t) => t.status === "pending" && t.reviewer === ""),
  ).toBe(true);
  expect(p.partition).toHaveLength(f.rows.length);
  expect(new Set(p.partition.map((r) => r.barcode)).size).toBe(f.rows.length);
  expect(p.partition.every((r) => !r.import_allowed && !r.send_allowed)).toBe(
    true,
  );
  expect(run(f)).toEqual(p);
  expect(f).toEqual(before);
});
it("retains candidates with taxonomy, destination name and cross-classification concerns outside priorities", () => {
  for (const mutate of [
    (f) => f.taxonomy.paths.push({ needs_review: true, barcodes: ["2"] }),
    (f) => f.snapshot.products.push({ id: "other", name: " a " }),
    (f) => {
      f.rows[1].fields.categoria = "OTHER";
      f.applied = structuredClone(f.rows);
    },
  ]) {
    const f = fixture();
    mutate(f);
    const p = run(f);
    expect(p.priority.every((c) => c.product_name_proposed !== "A")).toBe(true);
    expect(p.summary.sufficient_proposals_for_target).toBe(false);
  }
});
it("does not ignore a source base record or an unparsed member with the same literal delimiter", () => {
  for (const desc of ["A", "AT.UNKNOWN"]) {
    const f = fixture(),
      extra = structuredClone(f.rows[1]);
    Object.assign(extra, { barcode: "7", description: desc });
    Object.assign(extra.fields, { "clave1 *": "7", "descripción *": desc });
    f.rows.push(extra);
    f.applied = structuredClone(f.rows);
    expect(run(f).priority.every((c) => c.product_name_proposed !== "A")).toBe(
      true,
    );
  }
});
it("does not split numeric tails or infer size by stripping a final number", () => {
  const f = fixture();
  f.rows[1].description = f.rows[1].fields["descripción *"] = "A27";
  f.applied = structuredClone(f.rows);
  expect(
    run(f).cases.find((c) => c.members.some((r) => r.barcode === "2")).kind,
  ).toBe("UNSPLIT_RECORD");
});
it("retains an existing unanswered owner question and rejects stale or duplicate holds", () => {
  const f = fixture(),
    hold = {
      barcode: "2",
      description: "AT.S",
      reason: "Owner answer pending",
    };
  const runHeld = (holds) =>
    coverageReview(f.rows, f.applied, f.snapshot, f.taxonomy, 50, holds);
  expect(
    runHeld([hold]).priority.every((c) => c.product_name_proposed !== "A"),
  ).toBe(true);
  expect(() => runHeld([hold, hold])).toThrow("INVALID_OR_STALE_HOLD");
  expect(() => runHeld([{ ...hold, description: "OLD" }])).toThrow(
    "INVALID_OR_STALE_HOLD",
  );
});
it("rejects changed source literals, duplicate codes and an incompatible applied reference", () => {
  for (const mutate of [
    (f) => (f.rows[1].fields["clave1 *"] = "02"),
    (f) => f.rows.push(structuredClone(f.rows[1])),
    (f) => f.applied.pop(),
    (f) => (f.applied[1].fields.precio1 = "500.00"),
  ]) {
    const f = fixture();
    mutate(f);
    expect(() => run(f)).toThrow();
  }
});
it("rejects staging edits, inventory, wrong projects and incomplete destination names", () => {
  for (const mutate of [
    (f) => (f.snapshot.inventory_balances = 1),
    (f) => (f.snapshot.project_id = "production"),
    (f) => f.snapshot.rows[0].current.price_cents++,
    (f) => (f.snapshot.products = []),
  ]) {
    const f = fixture();
    mutate(f);
    expect(() => run(f)).toThrow();
  }
});
it("keeps Woo source changes visible separately from the applied catalog audit", () => {
  const f = fixture();
  f.rows[0].product_id = null;
  f.rows[0].variation_id = null;
  const p = run(f);
  expect(p.audit.summary.review_rows).toBe(0);
  expect(p.latest_source_audit.summary.review_rows).toBe(1);
});
it("rejects out-of-range targets and never presents an insufficient pool as reaching the goal", () => {
  const f = fixture();
  for (const target of [0, 100, 50.5, NaN])
    expect(() => run(f, target)).toThrow("INVALID_COVERAGE_TARGET");
  f.taxonomy.paths.push({ needs_review: true, barcodes: ["2", "5"] });
  expect(run(f).summary.sufficient_proposals_for_target).toBe(false);
});
it("pending templates cannot generate an approved SICAR load", () => {
  const p = run(fixture());
  expect(planSicarOnly(p.review, p.templates).summary.reviewed_rows).toBe(0);
  expect(() => prepareSicarBatches(p.review, p.templates)).toThrow(
    "BLOCKED_DECISIONS",
  );
});
it("escapes source text and emits no approval controls", () => {
  const p = run(fixture());
  p.priority[0].product_name_proposed = '</script><img src=x onerror="x">';
  const html = coverageHtml(p);
  expect(html).toContain("&lt;/script&gt;");
  expect(html).not.toContain("<img");
  expect(html).toContain("No están cargadas ni aprobadas");
});
it("reproduces all pinned artifacts and refuses changed input or existing output", async () => {
  const f = fixture(),
    root = await mkdtemp(join(tmpdir(), "m9-coverage-"));
  const values = {
      rows: f.rows,
      applied: f.applied,
      snapshot: f.snapshot,
      taxonomy: f.taxonomy,
      manifest: { sicar_sha256: "a".repeat(64), woo_sha256: "b".repeat(64) },
      holds: [],
    },
    inputs = {};
  for (const [key, value] of Object.entries(values)) {
    const bytes = JSON.stringify(value);
    await writeFile(join(root, key + ".json"), bytes);
    inputs[key] = {
      path: key + ".json",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  const config = join(root, "config.json");
  await writeFile(config, JSON.stringify({ inputs, target_percent: 50 }));
  await prepareCoverageReview(config, join(root, "one"));
  await prepareCoverageReview(config, join(root, "two"));
  const hashes = JSON.parse(await readFile(join(root, "one", "sha256.json")));
  for (const name of [...Object.keys(hashes), "sha256.json"])
    expect(await readFile(join(root, "one", name), "utf8")).toBe(
      await readFile(join(root, "two", name), "utf8"),
    );
  await expect(
    prepareCoverageReview(config, join(root, "one")),
  ).rejects.toThrow();
  await writeFile(join(root, "rows.json"), "[]");
  await expect(
    prepareCoverageReview(config, join(root, "three")),
  ).rejects.toThrow("INPUT_HASH_CHANGED");
});
