import { it, expect } from "vitest";
import {
  checkStaging,
  checkFamilies,
  rehearse,
} from "../../scripts/m9/prepare-cutover-rehearsal.mjs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../../scripts/m9/prepare-web-content.mjs";

function fixture() {
  const fields = {
    "clave1 *": "0007",
    "descripción *": "MODELO27",
    departamento: "DAMA",
    categoria: "BOTAS",
    precio1: "250.50",
    existencia: "9",
  };
  const row = {
    barcode: "0007",
    fields,
    description: "MODELO27",
    product_id: 123,
    variation_id: 124,
    attributes: [{ name: "Talla", value: "27" }],
    classification: "MATCH_EXACT_VARIANT",
    manual_review: false,
    issues: [],
    commercial_checks: [],
  };
  const snapshot = {
    project_id: "zsezjtswqeijboezvado",
    inventory_rows: 0,
    inventory_movements: 0,
    rows: [
      {
        barcode: "0007",
        product_name: "Bota",
        description: "MODELO27",
        department: "DAMA",
        section: "BOTAS",
        price_cents: 25050,
        cost_cents: null,
        attributes: { TALLA: "27" },
        woo_product_id: 123,
        woo_variation_id: 124,
      },
    ],
  };
  return {
    rows: [row],
    snapshot,
    woo: { pagination_complete: true, products: [{ id: 123, name: "Bota" }] },
  };
}
it("keeps leading zeros and excludes stock changes from catalog comparison", () => {
  const x = fixture();
  x.rows[0].fields.existencia = "999";
  expect(checkStaging(x.rows, x.snapshot, x.woo)[0]).toMatchObject({
    barcode: "0007",
    state: "CATALOG_IDENTICAL",
    source_manual_review: false,
  });
});
it("routes missing and duplicate source codes to review without deletes", () => {
  const x = fixture();
  expect(checkStaging([], x.snapshot, x.woo)[0].state).toBe(
    "ABSENT_MANUAL_REVIEW_NO_DELETE",
  );
  expect(checkStaging([...x.rows, ...x.rows], x.snapshot, x.woo)[0].state).toBe(
    "DUPLICATE_MANUAL_REVIEW",
  );
});
it.each([
  "price_cents",
  "department",
  "woo_variation_id",
  "cost_cents",
  "attributes",
])("detects stale staging %s", (field) => {
  const x = fixture();
  x.snapshot.rows[0][field] =
    field === "attributes"
      ? { TALLA: "28" }
      : field === "department"
        ? "CABALLERO"
        : 999;
  expect(checkStaging(x.rows, x.snapshot, x.woo)[0].differences).toContain(
    field,
  );
});
it("refuses other environments and inventory-bearing snapshots", () => {
  const x = fixture();
  x.snapshot.project_id = "production";
  expect(() => checkStaging(x.rows, x.snapshot, x.woo)).toThrow(
    "STAGING_SNAPSHOT",
  );
  x.snapshot.project_id = "zsezjtswqeijboezvado";
  x.snapshot.inventory_rows = 1;
  expect(() => checkStaging(x.rows, x.snapshot, x.woo)).toThrow("INVENTORY");
});
it("keeps source ambiguity pending even when catalog fields match", () => {
  const x = fixture();
  x.rows[0].classification = "AMBIGUOUS";
  expect(checkStaging(x.rows, x.snapshot, x.woo)[0].source_manual_review).toBe(
    true,
  );
});
it("generates identical read-only reports and rejects a modified source before output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m9-cut-"));
  try {
    const x = fixture(),
      woo = JSON.stringify(x.woo),
      sicar = "SICAR test bytes",
      rows = JSON.stringify(x.rows),
      manifest = JSON.stringify({
        woo_sha256: sha256(woo),
        sicar_sha256: sha256(sicar),
      });
    for (const name of ["previous", "current"]) {
      await mkdir(join(dir, name));
      await writeFile(join(dir, name, "filas.json"), rows);
      await writeFile(join(dir, name, "manifest.json"), manifest);
      await writeFile(
        join(dir, name, "sha256.json"),
        JSON.stringify({
          "filas.json": sha256(rows),
          "manifest.json": sha256(manifest),
        }),
      );
    }
    await writeFile(join(dir, "snapshot.json"), JSON.stringify(x.snapshot));
    await writeFile(join(dir, "woo.json"), woo);
    await writeFile(join(dir, "sicar.xlsx"), sicar);
    const args = [
      join(dir, "previous"),
      join(dir, "current"),
      join(dir, "snapshot.json"),
      join(dir, "woo.json"),
      join(dir, "sicar.xlsx"),
    ];
    await rehearse(...args, join(dir, "a"));
    await rehearse(...args, join(dir, "b"));
    const first = await readFile(join(dir, "a/ensayo.json"), "utf8");
    expect(first).toBe(await readFile(join(dir, "b/ensayo.json"), "utf8"));
    expect(JSON.parse(first)).toMatchObject({
      production_allowed: false,
      automatic_import_allowed: false,
      inventory_included: false,
    });
    await writeFile(join(dir, "sicar.xlsx"), "changed");
    await expect(rehearse(...args, join(dir, "bad"))).rejects.toThrow(
      "SOURCE_HASH_MISMATCH",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps a missing Woo size on hold without inventing a barcode", () => {
  const x = fixture();
  x.woo.products[0].type = "variable";
  x.woo.products[0].variations = [{ id: 124 }, { id: 125 }];
  expect(checkFamilies(x.snapshot, x.woo)[0]).toMatchObject({
    missing_woo_variation_ids: [125],
    holds: ["INCOMPLETE_WOO_FAMILY_REVIEW"],
    commercial_approved: false,
  });
});
it("keeps mixed departments pending even with a complete family", () => {
  const x = fixture();
  x.woo.products[0].type = "variable";
  x.woo.products[0].variations = [{ id: 124 }, { id: 125 }];
  x.snapshot.rows.push({
    ...x.snapshot.rows[0],
    barcode: "0008",
    department: "CABALLERO",
    woo_variation_id: 125,
  });
  expect(checkFamilies(x.snapshot, x.woo)[0]).toMatchObject({
    missing_woo_variation_ids: [],
    holds: ["DIVERGENT_DEPARTMENTS_REVIEW"],
    commercial_approved: false,
  });
});
