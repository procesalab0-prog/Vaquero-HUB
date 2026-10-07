import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  wooRefresh,
  prepareWooRefresh,
} from "../../scripts/m9/prepare-woo-refresh.mjs";
const clone = (v) => structuredClone(v),
  sha = (v) => createHash("sha256").update(v).digest("hex");
function fixture() {
  const p = {
    id: 10,
    type: "variable",
    status: "publish",
    name: "Camisa",
    short_description: "ABC",
    sku: "",
    description: "Texto",
    images: "https://vaquerosm.com/photo.jpg",
    categories: "Ropa",
    attributes: [{ name: "Talla", option: "M", variation: true }],
    source_fields: {},
    variations: [
      {
        id: 11,
        type: "variation",
        status: "publish",
        attributes: [{ name: "Talla", option: "M" }],
        price: "740",
        sale_price: "",
        manage_stock: true,
        stock_quantity: "2",
        source_fields: { Inventario: "2" },
      },
    ],
  };
  const previous = {
    schema_version: 1,
    scope: "authenticated_csv_excludes_trash",
    pagination_complete: true,
    expected_parents_from_panel: 1,
    source_records: 2,
    source_csv_sha256: "a".repeat(64),
    products: [p],
  };
  const row = {
    barcode: "0042",
    description: "ABCM",
    product_id: 10,
    variation_id: 11,
    attributes: [{ name: "Talla", value: "M" }],
    fields: {
      "clave1 *": "0042",
      "descripción *": "ABCM",
      departamento: "CABALLERO",
      categoria: "CAMISAS",
      precio1: "740",
    },
  };
  const current = {
    barcode: "0042",
    description: "ABCM",
    department: "CABALLERO",
    section: "CAMISAS",
    price_cents: 74000,
    cost_cents: null,
    attributes: { TALLA: "M" },
    product_name: "Camisa",
    woo_product_id: 10,
    woo_variation_id: 11,
  };
  return {
    previous,
    current: clone(previous),
    rows: [row],
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      inventory_balances: 0,
      inventory_movements: 0,
      rows: [
        { product_id: "p1", variant_id: "v1", current, stored: clone(current) },
      ],
    },
  };
}
const run = (f) => wooRefresh(f.previous, f.current, f.rows, f.snapshot);

it("compares equal authenticated exports without mutation, permissions or inventory values", () => {
  const f = fixture(),
    before = clone(f),
    p = run(f);
  expect(f).toEqual(before);
  expect(p.summary).toMatchObject({
    states: { UNCHANGED: 1 },
    staged_parent_impacts: 0,
    approved_refreshes: 0,
    approved_deletions: 0,
  });
  expect(p.items[0]).toMatchObject({
    staged_codes: ["0042"],
    refresh_allowed: false,
    delete_allowed: false,
    send_allowed: false,
  });
});

it("separates stock-only edits and ignores CSV row position without exporting stock", () => {
  const f = fixture(),
    v = f.current.products[0].variations[0];
  v.stock_quantity = "PRIVATE_STOCK_VALUE";
  v.source_fields.Inventario = "PRIVATE_STOCK_VALUE";
  v.csv_record = 999;
  const p = run(f);
  expect(p.items[0].state).toBe("INVENTORY_ONLY_EXCLUDED");
  expect(p.staged_impact).toEqual([]);
  expect(JSON.stringify(p)).not.toContain("PRIVATE_STOCK_VALUE");
});

it("excludes native stock availability while retaining purchase policy changes for review", () => {
  const f = fixture();
  f.current.products[0].source_fields["¿En inventario?"] =
    "PRIVATE_AVAILABILITY";
  f.current.products[0].variations[0].source_fields["¿En inventario?"] =
    "PRIVATE_AVAILABILITY";
  const inventory = run(f);
  expect(inventory.items[0].state).toBe("INVENTORY_ONLY_EXCLUDED");
  expect(inventory.staged_impact).toEqual([]);
  expect(JSON.stringify(inventory)).not.toContain("PRIVATE_AVAILABILITY");
  f.current.products[0].source_fields[
    "¿Permitir reservas de productos agotados?"
  ] = "1";
  expect(run(f).items[0].state).toBe("SOURCE_CHANGED_MANUAL_REVIEW");
});

it("detects editorial, taxonomy, price and scheduled promotion changes without altering SICAR price", () => {
  const f = fixture(),
    p = f.current.products[0];
  p.images = "new-photo";
  p.description = "Texto nuevo";
  p.categories = "Otra";
  p.variations[0].price = "900";
  p.variations[0].source_fields["Día en que empieza el precio rebajado"] =
    "2026-10-10";
  const result = run(f);
  expect(result.items[0].kinds).toEqual([
    "commercial",
    "editorial",
    "taxonomy",
  ]);
  expect(result.staged_impact[0].variants[0]).toMatchObject({
    barcode: "0042",
    product_id: "p1",
    variant_id: "v1",
    woo_variation_id: 11,
  });
  expect(f.snapshot.rows[0].current.price_cents).toBe(74000);
  expect(result.staged_impact[0].write_allowed).toBe(false);
});

it("holds removed parents and variations without deleting; new variations never receive a guessed barcode", () => {
  const f = fixture();
  f.current.products[0].variations = [
    { ...clone(f.previous.products[0].variations[0]), id: 12 },
  ];
  const result = run(f);
  expect(result.items[0].variation_changes.map((v) => v.state)).toEqual([
    "ABSENT_VARIATION_NO_DELETE",
    "NEW_VARIATION_REVIEW",
  ]);
  expect(result.items[0].delete_allowed).toBe(false);
  expect(result.items[0].staged_codes).toEqual(["0042"]);
  f.current.products = [];
  f.current.expected_parents_from_panel = 0;
  f.current.source_records = 0;
  expect(run(f).items[0].state).toBe("ABSENT_PARENT_NO_DELETE");
});

it("detects variant transfer between parents and parent-to-variation role changes", () => {
  const f = fixture(),
    second = {
      ...clone(f.current.products[0]),
      id: 20,
      name: "Otro",
      variations: f.current.products[0].variations,
    };
  f.current.products[0].variations = [];
  f.current.products.push(second);
  f.current.expected_parents_from_panel = 2;
  f.current.source_records = 3;
  const result = run(f);
  expect(result.identity_movements).toEqual([
    {
      id: 11,
      previous_parent_id: 10,
      current_parent_id: 20,
      previous_role: "variation",
      current_role: "variation",
      state: "IDENTITY_MOVED_MANUAL_REVIEW",
    },
  ]);
  expect(result.staged_impact.map((p) => p.woo_product_id)).toEqual([10, 20]);
  second.variations[0].id = 10;
  f.current.products.splice(0, 1);
  f.current.expected_parents_from_panel = 1;
  f.current.source_records = 2;
  expect(run(f).identity_movements[0].previous_role).toBe("parent");
  expect(run(f).identity_movements[0].current_role).toBe("variation");
});

it("retains private/draft status and unknown source columns as review evidence", () => {
  const f = fixture(),
    p = f.current.products[0];
  p.status = "private";
  p.source_fields["¿Vendido individualmente?"] = "1";
  p.source_fields["Atributo global 1"] = "1";
  expect(run(f).items[0].kinds).toEqual(["other_source_fields", "status"]);
  expect(run(f).items[0].current_status).toBe("private");
  p.status = "draft";
  expect(run(f).items[0].current_status).toBe("draft");
});

it("does not hide changes that only appear in mapped CSV fields", () => {
  const f = fixture();
  f.current.products[0].source_fields["Descripción corta"] = "DIFFERENT";
  f.current.products[0].source_fields["Valor(es) del atributo 1"] = "L";
  expect(run(f).items[0].kinds).toEqual(["identity", "taxonomy"]);
});

it("rejects incomplete/public exports, mismatched counts, duplicate IDs and changed staging", () => {
  for (const mutate of [
    (f) => (f.current.scope = "published_public"),
    (f) => (f.current.pagination_complete = false),
    (f) => (f.current.expected_parents_from_panel = 2),
    (f) => (f.current.source_records = 1),
    (f) => (f.current.products[0].variations[0].id = 10),
    (f) => (f.snapshot.inventory_balances = 1),
    (f) => (f.snapshot.project_id = "production"),
    (f) => (f.snapshot.rows[0].current.price_cents = 90000),
  ]) {
    const f = fixture();
    mutate(f);
    expect(() => run(f)).toThrow();
  }
});

it("ignores variation ordering but protects attribute order/content and sale policy", () => {
  const f = fixture();
  const second = { ...clone(f.previous.products[0].variations[0]), id: 12 };
  for (const x of [f.previous, f.current]) {
    x.products[0].variations.push(clone(second));
    x.source_records = 3;
  }
  f.current.products[0].variations.reverse();
  expect(run(f).items[0].state).toBe("UNCHANGED");
  f.current.products[0].variations[0].attributes[0].option = "L";
  expect(run(f).items[0].state).toBe("SOURCE_CHANGED_MANUAL_REVIEW");
});

it("rejects staged links absent from both exports instead of silently omitting them", () => {
  const f = fixture();
  f.rows[0].product_id = 999;
  for (const r of [f.snapshot.rows[0].current, f.snapshot.rows[0].stored])
    r.woo_product_id = 999;
  expect(() => run(f)).toThrow("STAGED_PARENT_ABSENT_FROM_BOTH_EXPORTS");
  f.rows[0].product_id = 10;
  f.rows[0].variation_id = 777;
  for (const r of [f.snapshot.rows[0].current, f.snapshot.rows[0].stored]) {
    r.woo_product_id = 10;
    r.woo_variation_id = 777;
  }
  expect(() => run(f)).toThrow("STAGED_VARIATION_NOT_IN_VERIFIED_PARENT");
});

it("reproduces pinned CLI output and rejects tampered input and overwrites before mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m9-woo-refresh-"));
  try {
    const f = fixture(),
      inputs = {};
    for (const [key, value] of Object.entries(f)) {
      const bytes = JSON.stringify(value);
      await writeFile(join(dir, key + ".json"), bytes);
      inputs[key] = { path: key + ".json", sha256: sha(bytes) };
    }
    const config = join(dir, "config.json");
    await writeFile(
      config,
      JSON.stringify({ evidence_scope: "HISTORICAL_REHEARSAL", inputs }),
    );
    await prepareWooRefresh(config, join(dir, "one"));
    await prepareWooRefresh(config, join(dir, "two"));
    for (const name of await readdir(join(dir, "one")))
      expect(await readFile(join(dir, "one", name))).toEqual(
        await readFile(join(dir, "two", name)),
      );
    await expect(prepareWooRefresh(config, join(dir, "one"))).rejects.toThrow();
    await writeFile(join(dir, "current.json"), "{}");
    await expect(prepareWooRefresh(config, join(dir, "bad"))).rejects.toThrow(
      "INPUT_HASH_CHANGED",
    );
    await expect(readdir(join(dir, "bad"))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
