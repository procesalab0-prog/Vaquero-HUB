import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DESCRIPTION_CODES,
  prepareSicarDescriptions,
  writeSicarDescriptionPlan,
} from "../../scripts/m9/catalogo-descripciones-siete-plan.mjs";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const before = [],
    after = [],
    state = [];
  for (const [i, barcode] of DESCRIPTION_CODES.entries()) {
    const suffix = ["26", "27", "27.5", "28", "28.5", "29", "30"][i];
    const fields = {
      "clave1 *": barcode,
      clave2: "",
      "descripción *": "BCUAROPSATROARE" + suffix,
      características: "",
      departamento: "CABALLERO",
      categoria: "BOTAS CUADRA",
      "(s/n) inventariable": "s",
      "(s/n) receta": "n",
      "(s/n) lotes": "n",
      unidad: "PIEZA",
      "(s/n) peso automático": "n",
      "(s/n) favorito": "n",
      "clave sat": "",
      costo: "0",
      precio1: "6500",
      precio2: "",
      precio3: "",
      precio4: "",
      mayoreo2: "",
      mayoreo3: "",
      mayoreo4: "",
      "(s/n) precio con impuestos": "s",
      "(s/n) imp IVA (16%)": "",
      "(s/n) granel": "n",
      existencia: "1",
      inv_min: "",
      inv_max: "",
      "(s/n) mostrar en sicarShop": "s",
      "(s/n) mostrar en ventas": "s",
      "localización 1": "",
      "localización 2": "",
      "localización 3": "",
    };
    const source = {
      barcode,
      description: fields["descripción *"],
      fields,
      issues: [],
      commercial_checks: [],
      display_only: null,
      product_id: null,
      variation_id: null,
      candidate_product_ids: [],
      candidate_variation_ids: [],
    };
    before.push(source);
    const fresh = structuredClone(source);
    fresh.description = "BCUARESROPSATROARE" + suffix;
    fresh.fields["descripción *"] = fresh.description;
    after.push(fresh);
    const current = {
      barcode,
      description: source.description,
      product_name: source.description + " [SICAR " + barcode + "]",
      department: "CABALLERO",
      section: "BOTAS CUADRA",
      price_cents: 650000,
      cost_cents: null,
      attributes: {},
      family_key: "prov-synthetic-" + i,
      woo_variation_id: null,
    };
    state.push({
      barcode,
      variant_id: uuid(i + 1),
      current,
      managed: {
        barcode,
        variant_id: uuid(i + 1),
        source_sha256: "a".repeat(64),
        source_row: structuredClone(current),
      },
      product: { id: uuid(i + 100), name: current.product_name },
      variant: {
        id: uuid(i + 1),
        product_id: uuid(i + 100),
        price_cents: 650000,
        cost_cents: null,
        woocommerce_product_id: null,
        woocommerce_variation_id: null,
      },
      details: { source_description: source.description },
      category: { is_active: true },
      family_size: 1,
      code_bindings: 1,
      barcodes: [{ code: barcode, source: "SICAR", variant_id: uuid(i + 1) }],
      attributes: [],
      attribute_values: [],
      independent_parent: {
        product_id: uuid(i + 100),
        family_key: current.family_key,
        source_name: current.product_name,
      },
      provisional: {
        original_product_id: uuid(i + 100),
        source_sha256: "a".repeat(64),
        grouping_status: "PROVISIONAL",
        grouping_event_id: null,
        web_release: false,
        source_evidence: {
          barcode,
          fields: structuredClone(fields),
          grouping_status: "PROVISIONAL",
          web_release: false,
        },
      },
      web: {
        source: null,
        draft: null,
        link: null,
        category: null,
        family: null,
        approval: null,
        photos: 0,
        lab_jobs: 0,
        remote_jobs: 0,
        lab_enabled: null,
      },
    });
  }
  return {
    before,
    after,
    context: { observed_at: "2026-10-23T02:53:36.602Z", expected_state: state },
    asOf: "2026-10-23T02:54:00.000Z",
    request_id: uuid(999),
    source_before_sha256:
      "33b1d36200f8db0eecf0cd1fbdd1c76400ee291d747348a6c87881f39043cc44",
    source_after_sha256:
      "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93",
  };
}
describe("bounded literal SICAR description refresh", () => {
  it("prepares exactly7 literal texts with no inferred model or other mutation", () => {
    const f = fixture(),
      saved = structuredClone(f),
      p = prepareSicarDescriptions(f);
    expect(p.payload.changes).toHaveLength(7);
    expect(f).toEqual(saved);
    expect(p.summary.stock_cost_price_woo_writes).toBe(0);
    expect(p.summary.grouping_decisions_generated).toBe(0);
    expect(p.payload.changes[0].new_description).toBe("BCUARESROPSATROARE26");
  });
  const cases = [
    [
      "different cut",
      (f) => (f.source_after_sha256 = "b".repeat(64)),
      /ORIGINAL_CUTS/,
    ],
    ["invalid request", (f) => (f.request_id = "no"), /REQUEST_UUID/],
    ["stale snapshot", (f) => (f.asOf = "2026-10-23T03:54:00.000Z"), /STALE/],
    ["future snapshot", (f) => (f.asOf = "2026-10-23T01:54:00.000Z"), /STALE/],
    ["missing code", (f) => f.context.expected_state.pop(), /FIXED_SEVEN/],
    [
      "source duplicate",
      (f) => f.before.push(structuredClone(f.before[0])),
      /DUPLICATE/,
    ],
    [
      "source Woo suggestion",
      (f) => (f.after[0].candidate_product_ids = [1]),
      /SOURCE_BLOCKED_OR_WOO/,
    ],
    ["source price", (f) => (f.after[0].fields.precio1 = "6501"), /NON_TEXT/],
    ["source stock", (f) => (f.after[0].fields.existencia = "2"), /NON_TEXT/],
    [
      "source tax",
      (f) => (f.after[0].fields.departamento = "DAMA"),
      /NON_TEXT/,
    ],
    [
      "forged text",
      (f) => {
        f.after[0].description += "X";
        f.after[0].fields["descripción *"] += "X";
      },
      /LITERAL_SOURCE_SHA/,
    ],
    [
      "UUID binding",
      (f) => (f.context.expected_state[0].barcodes[0].variant_id = uuid(9999)),
      /IDENTITY/,
    ],
    [
      "second binding",
      (f) => (f.context.expected_state[0].code_bindings = 2),
      /IDENTITY/,
    ],
    [
      "grouped",
      (f) =>
        (f.context.expected_state[0].provisional.grouping_status = "GROUPED"),
      /IDENTITY/,
    ],
    [
      "web release",
      (f) => (f.context.expected_state[0].provisional.web_release = true),
      /IDENTITY/,
    ],
    [
      "changed original SHA",
      (f) =>
        (f.context.expected_state[0].managed.source_sha256 = "b".repeat(64)),
      /IDENTITY/,
    ],
    [
      "destination drift",
      (f) => (f.context.expected_state[0].current.description += "X"),
      /IDENTITY/,
    ],
    [
      "price drift",
      (f) => f.context.expected_state[0].variant.price_cents++,
      /BASELINE/,
    ],
    [
      "cost",
      (f) => (f.context.expected_state[0].variant.cost_cents = 0),
      /BASELINE/,
    ],
    [
      "native Woo",
      (f) => (f.context.expected_state[0].variant.woocommerce_product_id = 1),
      /BASELINE/,
    ],
    [
      "inferred attrs",
      (f) => (f.context.expected_state[0].attributes = [{ TALLA: "26" }]),
      /BASELINE/,
    ],
    [
      "manual name",
      (f) => (f.context.expected_state[0].product.name = "MANUAL"),
      /BASELINE/,
    ],
    [
      "web draft",
      (f) => (f.context.expected_state[0].web.draft = { manual: true }),
      /WEB_CONTEXT/,
    ],
    [
      "own photos",
      (f) => (f.context.expected_state[0].web.photos = 1),
      /WEB_CONTEXT/,
    ],
    [
      "original evidence",
      (f) =>
        (f.context.expected_state[0].provisional.source_evidence.fields[
          "descripción *"
        ] = "MANUAL"),
      /ORIGINAL_EVIDENCE/,
    ],
  ];
  for (const [name, mutate, re] of cases)
    it("holds " + name, () => {
      const f = fixture();
      mutate(f);
      expect(() => prepareSicarDescriptions(f)).toThrow(re);
    });
  it("writes reproducibly to new folders and refuses overwrite or changed bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m9-text-seven-"));
    try {
      const f = fixture(),
        inputs = {};
      const digest = (x) => createHash("sha256").update(x).digest("hex");
      for (const name of ["before", "after", "context"]) {
        const bytes = JSON.stringify(f[name]);
        const path = join(dir, name + ".json");
        await writeFile(path, bytes);
        inputs[name] = { path, sha256: digest(bytes) };
      }
      const {
        before: _before,
        after: _after,
        context: _context,
        ...metadata
      } = f;
      void _before;
      void _after;
      void _context;
      const config = join(dir, "config.json");
      await writeFile(config, JSON.stringify({ inputs, metadata }));
      await writeSicarDescriptionPlan(config, join(dir, "one"));
      await writeSicarDescriptionPlan(config, join(dir, "two"));
      expect(await readFile(join(dir, "one", "payload.json"), "utf8")).toBe(
        await readFile(join(dir, "two", "payload.json"), "utf8"),
      );
      await expect(
        writeSicarDescriptionPlan(config, join(dir, "one")),
      ).rejects.toThrow(/EEXIST/);
      await writeFile(inputs.after.path, "{}");
      await expect(
        writeSicarDescriptionPlan(config, join(dir, "three")),
      ).rejects.toThrow(/INPUT_SHA_CHANGED/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
