import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  completeCut,
  reviewDestinationNames,
  prepareCompleteCut,
} from "../../scripts/m9/prepare-complete-cut.mjs";
const clone = (x) => structuredClone(x),
  sha = (s) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const r = {
    barcode: "0042",
    description: "ABM",
    fields: {
      "clave1 *": "0042",
      "descripción *": "ABM",
      departamento: "CABALLERO",
      categoria: "CAMISAS",
      precio1: "740",
      existencia: "2",
    },
    product_id: 10,
    variation_id: 11,
    attributes: [{ name: "Talla", value: "M" }],
    classification: "MATCH_EXACT_VARIANT",
    manual_review: false,
    reasons: [],
    issues: [],
    commercial_checks: [],
    candidate_product_ids: [10],
  };
  const current = {
    barcode: "0042",
    description: "ABM",
    department: "CABALLERO",
    section: "CAMISAS",
    attributes: { TALLA: "M" },
    price_cents: 74000,
    cost_cents: null,
    product_name: "Camisa",
    woo_product_id: 10,
    woo_variation_id: 11,
  };
  const snapshot = {
    project_id: "zsezjtswqeijboezvado",
    inventory_balances: 0,
    inventory_movements: 0,
    rows: [
      { variant_id: "v1", product_id: "p1", current, stored: clone(current) },
    ],
  };
  const woo = {
    pagination_complete: true,
    products: [
      { id: 10, name: "Camisa", short_description: "AB", status: "publish" },
      { id: 20, name: "Camisa", short_description: "CD", status: "publish" },
      { id: 30, name: "Hebilla", short_description: "EF", status: "private" },
    ],
  };
  const destination = {
    project_id: snapshot.project_id,
    parents: [
      { product_id: "p1", woo_id: 10, name: "Camisa", search_name: "camisa" },
    ],
  };
  const pending = {
    ...clone(r),
    barcode: "0077",
    description: "CDL",
    product_id: 20,
    variation_id: 21,
    candidate_product_ids: [20],
    attributes: [{ name: "Talla", value: "L" }],
    fields: { ...r.fields, "clave1 *": "0077", "descripción *": "CDL" },
  };
  const currentRows = [r, pending],
    reserved = [
      {
        barcode: "0077",
        woo_product_id: 20,
        woo_variation_id: 21,
        product_name: "Camisa",
      },
    ];
  return {
    previous: clone(currentRows),
    current: currentRows,
    snapshot,
    woo,
    destination,
    reserved,
  };
}
const run = (f) =>
  completeCut(
    f.previous,
    f.current,
    f.snapshot,
    f.woo,
    f.destination,
    f.reserved,
  );
it("partitions every source row without granting imports; names retain distinct identities", () => {
  const f = fixture(),
    before = JSON.stringify(f),
    p = run(f);
  expect(JSON.stringify(f)).toBe(before);
  expect(p.summary.states).toEqual({
    DESTINATION_NAME_REVIEW: 1,
    STAGED_IDENTICAL: 1,
  });
  expect(p.name_reviews[0].state).toBe("DISTINCT_MANAGED_IDENTITIES_EVIDENCED");
  expect(p.name_reviews[0].import_allowed).toBe(false);
  expect(p.ledger[0].barcode).toBe("0042");
  expect(p.woo_only[0].woo_product_id).toBe(30);
  expect(p.summary.source_rows).toBe(
    p.ledger.reduce((n, r) => n + r.source_rows, 0),
  );
});
it("separates destination edits from changed source prices without proposing overwrites", () => {
  const f = fixture();
  f.snapshot.rows[0].current.price_cents = 99900;
  expect(run(f).ledger[0].state).toBe("DESTINATION_EDIT_REVIEW");
  f.snapshot.rows[0].current.price_cents = 74000;
  f.current[0].fields.precio1 = "750";
  const p = run(f);
  expect(p.ledger[0].state).toBe("STAGED_SOURCE_CHANGE_REVIEW");
  expect(p.summary.source_changes.PUBLIC_PRICE_CHANGE_REVIEW).toBe(1);
});
it("stock changes are excluded; missing codes never become deletes", () => {
  const f = fixture();
  f.current[0].fields.existencia = "999";
  expect(run(f).ledger[0].state).toBe("STAGED_IDENTICAL");
  expect(run(f).summary.source_changes.INVENTORY_ONLY_EXCLUDED).toBe(1);
  f.current.shift();
  const p = run(f);
  expect(p.absent_staged[0].delete_allowed).toBe(false);
  expect(p.absent_staged[0].state).toBe("ABSENT_SOURCE_NO_DELETE");
});
it("holds duplicate source codes and never groups SICAR-only by suffix", () => {
  const f = fixture();
  f.current.push(clone(f.current[0]));
  expect(run(f).ledger[0].state).toBe("DUPLICATE_SOURCE_MANUAL_REVIEW");
  const g = fixture();
  g.current.push({
    ...clone(g.current[0]),
    barcode: "0099",
    classification: "SICAR_ONLY",
    product_id: null,
    variation_id: null,
    candidate_product_ids: [],
  });
  expect(run(g).ledger.find((r) => r.barcode === "0099").state).toBe(
    "PENDING_SICAR_ONLY",
  );
});
it("unmanaged, changed names and shared bases stay in manual review", () => {
  for (const change of [
    (f) => (f.destination.parents[0].woo_id = null),
    (f) => (f.destination.parents[0].name = "Otro"),
    (f) => (f.woo.products[1].short_description = "AB"),
  ]) {
    const f = fixture();
    change(f);
    expect(
      reviewDestinationNames(f.reserved, f.destination, f.woo)[0].state,
    ).toBe("MANUAL_IDENTITY_REVIEW");
  }
});
it("rejects wrong project, inventory and conflicting destination or reserved identities", () => {
  for (const change of [
    (f) => (f.snapshot.project_id = "production"),
    (f) => (f.snapshot.inventory_balances = 1),
    (f) => (f.destination.parents[0].woo_id = 30),
    (f) => (f.reserved[0].woo_variation_id = 99),
    (f) => f.snapshot.rows.push(clone(f.snapshot.rows[0])),
  ]) {
    const f = fixture();
    change(f);
    expect(() => run(f)).toThrow();
  }
});
it("fingerprints change with destination evidence; inputs remain immutable", () => {
  const f = fixture(),
    a = reviewDestinationNames(f.reserved, f.destination, f.woo)[0];
  f.destination.parents[0].product_id = "p2";
  const b = reviewDestinationNames(f.reserved, f.destination, f.woo)[0];
  expect(a.destination_sha256).not.toBe(b.destination_sha256);
  expect(a.candidate_sha256).toBe(b.candidate_sha256);
});
it("a refreshed Woo name requires review even with unchanged SICAR identity", () => {
  const f = fixture();
  f.woo.products[0].name = "Camisa nueva";
  const p = run(f);
  expect(p.ledger[0].state).toBe("STAGED_WOO_NAME_CHANGE_REVIEW");
  expect(p.summary.staged_review).toBe(1);
  expect(p.summary.staged_unchanged).toBe(0);
});
it("preserves preparation holds as overlapping observations without granting approval", () => {
  const f = fixture();
  const p = completeCut(
    f.previous,
    f.current,
    f.snapshot,
    f.woo,
    f.destination,
    f.reserved,
    [
      {
        barcode: "0077",
        reasons: [
          "FAMILIA_CON_SECCIONES_DISTINTAS",
          "CASO_DUENOS_FUERA_DEL_PILOTO",
        ],
      },
    ],
  );
  expect(
    p.summary.pending_preparation_holds.FAMILIA_CON_SECCIONES_DISTINTAS,
  ).toBe(1);
  expect(p.ledger[1].import_allowed).toBe(false);
  expect(() =>
    completeCut(
      f.previous,
      f.current,
      f.snapshot,
      f.woo,
      f.destination,
      f.reserved,
      [{ barcode: "unknown", reasons: [] }],
    ),
  ).toThrow("INVALID_PREPARATION_HOLDS");
});
it("CLI artifacts reproduce exactly, escape editorial HTML and reject tampering before output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m9-cut-"));
  try {
    const f = fixture();
    f.woo.products[2].name = "<script>alert(1)</script>";
    const values = {
        ...f,
        reserved: { rows: f.reserved },
        manifest: {
          woo_sha256: sha(JSON.stringify(f.woo)),
          sicar_sha256: "a".repeat(64),
          rules_version: "test",
        },
      },
      inputs = {};
    for (const [name, value] of Object.entries(values)) {
      const raw = JSON.stringify(value);
      await writeFile(join(dir, name + ".json"), raw);
      inputs[name] = { path: name + ".json", sha256: sha(raw) };
    }
    await writeFile(join(dir, "config.json"), JSON.stringify({ inputs }));
    await prepareCompleteCut(join(dir, "config.json"), join(dir, "a"));
    await prepareCompleteCut(join(dir, "config.json"), join(dir, "b"));
    const html = await readFile(join(dir, "a", "reporte.html"), "utf8");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    for (const name of await readdir(join(dir, "a")))
      expect(await readFile(join(dir, "a", name), "utf8")).toBe(
        await readFile(join(dir, "b", name), "utf8"),
      );
    await expect(
      prepareCompleteCut(join(dir, "config.json"), join(dir, "a")),
    ).rejects.toThrow();
    await writeFile(join(dir, "snapshot.json"), "{}");
    await expect(
      prepareCompleteCut(join(dir, "config.json"), join(dir, "c")),
    ).rejects.toThrow("INPUT_CHANGED:snapshot");
    expect(await readdir(dir)).not.toContain("c");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
