import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  renewedPilot,
  prepareRenewedPilot,
} from "../../scripts/m9/prepare-renewed-pilot.mjs";

it.each([37101, 37102, 37103])(
  "retains the owner's display-only hold for Woo %s even when a historical review and all source data match",
  (wooId) => {
    const f = fixture();
    for (const woo of [f.previousWoo, f.currentWoo]) woo.products[0].id = wooId;
    for (const rows of [f.previousRows, f.currentRows])
      for (const r of rows.filter((r) => r.product_id === 100))
        r.product_id = wooId;
    for (const r of f.snapshot.rows.filter(
      (r) => r.current.woo_product_id === 100,
    ))
      r.current.woo_product_id = wooId;
    const r = renewedPilot(f);
    expect(r.pilot.rows.every((r) => r.woo_product_id !== wooId)).toBe(true);
    expect(r.excluded.find((r) => r.barcode === "2396").reasons).toContain(
      "OWNER_DISPLAY_ONLY_HOLD_2026_10_05",
    );
  },
);

function fixture() {
  const rows = [],
    managed = [],
    ledger = [],
    products = [];
  for (let p = 0; p < 4; p++) {
    const parent = {
      id: 100 + p,
      type: "variable",
      status: "publish",
      name: "Producto " + p,
      short_description: "BASE" + p,
      description: "Descripción completa",
      images: "https://vaquerosm.com/foto.jpg",
      attributes: [{ name: "Talla", option: "S, M, L, XL", variation: true }],
      variations: [],
      source_fields: {},
      sale_price: "",
    };
    products.push(parent);
    for (let i = 0; i < 4; i++) {
      const n = p * 4 + i + 1,
        barcode = n === 1 ? "2396" : String(n).padStart(4, "0"),
        size = ["S", "M", "L", "XL"][i],
        variation = 1000 + n;
      parent.variations.push({
        id: variation,
        type: "variation",
        status: "publish",
        price: "740",
        sale_price: "",
        attributes: [{ name: "Talla", option: size }],
        source_fields: { "Precio normal": "740" },
        stock_quantity: "2",
        manage_stock: true,
      });
      const s = {
        barcode,
        description: `BASE${p}${size}`,
        classification: "MATCH_EXACT_VARIANT",
        manual_review: false,
        issues: [],
        commercial_checks: [],
        display_only: null,
        product_id: parent.id,
        variation_id: variation,
        attributes: [{ name: "Talla", value: size }],
        fields: {
          "clave1 *": barcode,
          "descripción *": `BASE${p}${size}`,
          departamento: p < 2 ? "CABALLERO" : "DAMA",
          categoria: "SECCION " + p,
          precio1: "740",
          existencia: "2",
          unidad: "PIEZA",
          "(s/n) inventariable": "s",
          "(s/n) mostrar en ventas": "s",
          "(s/n) granel": "n",
          "(s/n) receta": "n",
          "(s/n) lotes": "n",
        },
      };
      rows.push(s);
      const productId = "p" + p,
        variantId = "v" + n;
      const current = {
        barcode,
        description: s.description,
        department: s.fields.departamento,
        section: s.fields.categoria,
        price_cents: 74000,
        cost_cents: null,
        attributes: { TALLA: size },
        product_name: parent.name,
        woo_product_id: parent.id,
        woo_variation_id: variation,
      };
      managed.push({
        barcode,
        variant_id: variantId,
        product_id: productId,
        current,
        stored_matches: true,
        barcode_matches: true,
        allowlisted: true,
        review_matches: true,
        provisional: null,
        is_active: true,
        unit_code: "PIECE",
      });
      ledger.push({
        barcode,
        variant_id: variantId,
        product_id: productId,
        stage: "REVIEWED",
      });
    }
  }
  const woo = {
    schema_version: 1,
    scope: "authenticated_csv_excludes_trash",
    pagination_complete: true,
    source_csv_sha256: "a".repeat(64),
    expected_parents_from_panel: 4,
    source_records: 20,
    products,
  };
  return {
    previousRows: structuredClone(rows),
    currentRows: rows,
    previousWoo: structuredClone(woo),
    currentWoo: woo,
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      managed_count: 16,
      rows: managed,
      control: { enabled: true },
      operational: { sales: 2, returns: 1, inventory_movements: 8 },
    },
    phasePlan: {
      project_id: "zsezjtswqeijboezvado",
      production_allowed: false,
      ledger,
    },
    limit: 12,
    maxPerParent: 3,
  };
}
it("selects a small diverse pilot, preserves zeros and physical label and never grants stock or web writes", () => {
  const f = fixture(),
    before = structuredClone(f),
    r = renewedPilot(f);
  expect(r.pilot.rows).toHaveLength(12);
  expect(r.pilot.rows[0].barcode).toBe("2396");
  expect(r.pilot.rows.some((r) => r.barcode.startsWith("000"))).toBe(true);
  for (const p of [100, 101, 102, 103])
    expect(
      r.pilot.rows.filter((r) => r.woo_product_id === p).length,
    ).toBeLessThanOrEqual(3);
  expect(
    r.pilot.rows.every(
      (r) =>
        r.quantity_to_import === null &&
        r.reserved_to_import === null &&
        r.cost_cents === null &&
        !r.activation_allowed &&
        !r.web_writes_allowed,
    ),
  ).toBe(true);
  expect(r.pilot.stock_location_confirmed).toBe(false);
  expect(r.inventory_import_allowed).toBe(false);
  expect(r.production_allowed).toBe(false);
  expect(f).toEqual(before);
});
it.each(["0", "-1", "0.5", "", "garbage"])(
  "does not select unsupported or absent positive piece evidence: %s",
  (quantity) => {
    const f = fixture();
    f.currentRows[0].fields.existencia = quantity;
    expect(renewedPilot(f).pilot.rows.some((r) => r.barcode === "2396")).toBe(
      false,
    );
  },
);
it("excludes held, provisional and new codes even when stock and Woo identity appear clean", () => {
  const f = fixture();
  f.phasePlan.ledger[0].stage = "HELD";
  f.phasePlan.ledger[1].stage = "PROVISIONAL";
  f.phasePlan.ledger = f.phasePlan.ledger.slice(0, 2);
  expect(renewedPilot(f).pilot.rows).toEqual([]);
});
it("keeps new source price and classification edits in review instead of overwriting", () => {
  const f = fixture();
  f.currentRows[0].fields.precio1 = "800";
  f.currentRows[1].fields.departamento = "OTRO";
  const r = renewedPilot(f);
  expect(r.catalogue_impacts).toHaveLength(2);
  expect(r.pilot.rows.some((r) => ["2396", "0002"].includes(r.barcode))).toBe(
    false,
  );
  expect(f.snapshot.rows[0].current.price_cents).toBe(74000);
});
it("excludes changed Woo photos, base/attributes, promotions and moved IDs pending source review", () => {
  for (const change of [
    (p) => (p.images = "changed"),
    (p) => (p.short_description = "OTHER"),
    (p) => (p.attributes[0].option = "OTHER"),
    (p) => (p.sale_price = "100"),
    (p) => (p.status = "private"),
  ]) {
    const f = fixture();
    change(f.currentWoo.products[0]);
    expect(
      renewedPilot(f).pilot.rows.some((r) => r.woo_product_id === 100),
    ).toBe(false);
  }
  const f = fixture();
  f.currentWoo.products[1].variations.push(
    f.currentWoo.products[0].variations.pop(),
  );
  expect(renewedPilot(f).woo_comparison.identity_movements).toHaveLength(1);
});
it("rejects a duplicate literal source, duplicate destination or incomplete/public Woo export", () => {
  const f = fixture();
  f.currentRows.push(structuredClone(f.currentRows[0]));
  expect(() => renewedPilot(f)).toThrow("DUPLICATE_OR_NONLITERAL_SOURCE");
  const g = fixture();
  g.snapshot.rows[1].variant_id = g.snapshot.rows[0].variant_id;
  expect(() => renewedPilot(g)).toThrow("DUPLICATE_DESTINATION_IDENTITY");
  const h = fixture();
  h.currentWoo.scope = "public";
  expect(() => renewedPilot(h)).toThrow("COMPLETE_AUTHENTICATED_CSV_REQUIRED");
});
it("does not turn source absence into deletion and does not reset existing operational history", () => {
  const f = fixture();
  f.currentRows = f.currentRows.slice(1);
  const r = renewedPilot(f);
  expect(r.source_absences_no_delete).toEqual([
    { barcode: "2396", variant_id: "v1", delete_allowed: false },
  ]);
  expect(f.snapshot.operational.inventory_movements).toBe(8);
});
it("compares source and destination attributes and the exact literal code", () => {
  const f = fixture();
  f.snapshot.rows[0].current.attributes.TALLA = "XXL";
  expect(
    renewedPilot(f).excluded.find((r) => r.barcode === "2396").reasons,
  ).toContain("SOURCE_ATTRIBUTES_CHANGED");
});
it("reproduces pinned reports, escapes names and rejects overwrite and altered inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "m9-renewed-"));
  try {
    const f = fixture(),
      hash = (x) => createHash("sha256").update(x).digest("hex"),
      inputs = {};
    f.currentWoo.products[0].name = "<script>";
    f.previousWoo.products[0].name = "<script>";
    for (const r of f.snapshot.rows.filter(
      (r) => r.current.woo_product_id === 100,
    ))
      r.current.product_name = "<script>";
    for (const name of [
      "previousRows",
      "currentRows",
      "previousWoo",
      "currentWoo",
      "snapshot",
      "phasePlan",
    ]) {
      const raw = JSON.stringify(f[name]);
      await writeFile(join(root, name + ".json"), raw);
      inputs[name] = { path: name + ".json", sha256: hash(raw) };
    }
    const raw = JSON.stringify({
      woo_sha256: inputs.currentWoo.sha256,
      sicar_sha256: "b".repeat(64),
    });
    await writeFile(join(root, "manifest.json"), raw);
    inputs.manifest = { path: "manifest.json", sha256: hash(raw) };
    const config = join(root, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        inputs,
        sicar_sha256: "b".repeat(64),
        source_date: "2026-10-19",
      }),
    );
    await prepareRenewedPilot(config, join(root, "one"));
    await prepareRenewedPilot(config, join(root, "two"));
    expect(await readFile(join(root, "one/sha256.json"), "utf8")).toBe(
      await readFile(join(root, "two/sha256.json"), "utf8"),
    );
    expect(
      await readFile(join(root, "one/reporte.html"), "utf8"),
    ).not.toContain("<script>");
    await expect(
      prepareRenewedPilot(config, join(root, "one")),
    ).rejects.toThrow("EEXIST");
    await writeFile(join(root, "currentRows.json"), "[]");
    await expect(
      prepareRenewedPilot(config, join(root, "three")),
    ).rejects.toThrow("INPUT_CHANGED:currentRows");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
