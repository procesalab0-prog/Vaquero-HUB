import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRICE_CODES,
  prepareSicarPublicPrices,
  writeSicarPublicPricePlan,
} from "../../scripts/m9/catalogo-precio-publico-plan.mjs";
const sha = (x) => createHash("sha256").update(x).digest("hex"),
  uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const before = [],
    after = [],
    state = [];
  for (const [i, barcode] of PRICE_CODES.entries()) {
    const fields = {
      "clave1 *": barcode,
      "descripción *": "SYNTHETIC MODEL " + i,
      departamento: "CABALLERO",
      categoria: "PANTALONES",
      precio1: "980",
      precio2: "0",
      precio3: "0",
      precio4: "0",
      mayoreo2: "0",
      mayoreo3: "0",
      mayoreo4: "0",
      costo: "0",
      existencia: "3",
      unidad: "PIEZA",
      "(s/n) mostrar en ventas": "s",
      "(s/n) inventariable": "s",
      "(s/n) precio con impuestos": "s",
      "(s/n) granel": "n",
      "(s/n) receta": "n",
      "(s/n) lotes": "n",
    };
    const row = {
      barcode,
      description: fields["descripción *"],
      fields,
      issues: [],
      commercial_checks: [],
      display_only: null,
      product_id: null,
      variation_id: null,
      candidate_product_ids: [20470],
      candidate_variation_ids: [],
    };
    before.push(row);
    const fresh = structuredClone(row);
    fresh.fields.precio1 = "1150";
    after.push(fresh);
    const current = {
      attributes: {},
      barcode,
      cost_cents: null,
      department: fields.departamento,
      description: row.description,
      family_key: "prov-synthetic-" + i,
      price_cents: 98000,
      product_name: row.description + " [SICAR " + barcode + "]",
      section: fields.categoria,
      woo_variation_id: null,
    };
    state.push({
      barcode,
      variant_id: uuid(i + 1),
      current,
      managed: {
        source_sha256: "a".repeat(64),
        source_row: structuredClone(current),
      },
      variant: {
        id: uuid(i + 1),
        product_id: uuid(i + 101),
        price_cents: 98000,
        cost_cents: null,
        woocommerce_product_id: null,
        woocommerce_variation_id: null,
      },
      product: { id: uuid(i + 101) },
      family_size: 1,
      code_bindings: 1,
      barcodes: [{ code: barcode, variant_id: uuid(i + 1) }],
      provisional: {
        original_product_id: uuid(i + 101),
        source_sha256: "a".repeat(64),
        web_release: false,
        grouping_status: "PROVISIONAL",
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
    context: { observed_at: "2026-10-23T01:17:29.973Z", expected_state: state },
    source_before_sha256:
      "33b1d36200f8db0eecf0cd1fbdd1c76400ee291d747348a6c87881f39043cc44",
    source_after_sha256:
      "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93",
    request_id: uuid(999),
    asOf: "2026-10-23T01:18:00.000Z",
  };
}
describe("SICAR public-price maintenance preparer", () => {
  it("prepares only ten prices with independent Woo suggestions still held", () => {
    const f = fixture(),
      original = JSON.stringify(f),
      p = prepareSicarPublicPrices(f);
    expect(p.summary.price_updates_prepared).toBe(10);
    expect(p.summary.web_release).toBe(false);
    expect(p.owner_approval_generated).toBe(false);
    expect(
      p.payload.changes.every(
        (x) => x.previous_cents === 98000 && x.new_cents === 115000,
      ),
    ).toBe(true);
    expect(JSON.stringify(f)).toBe(original);
    expect(prepareSicarPublicPrices(f)).toEqual(p);
    expect(sha(p.payload.source_rows_json)).toBe(p.payload.source_rows_sha256);
  });
  it("retains the full original source rows and SHA provenance", () => {
    const f = fixture(),
      p = prepareSicarPublicPrices(f);
    expect(JSON.parse(p.payload.source_rows_json)[0]).toEqual({
      barcode: PRICE_CODES[0],
      before: f.before[0],
      after: f.after[0],
    });
    expect(p.payload.expected_state[0].managed.source_sha256).toBe(
      "a".repeat(64),
    );
  });
  it.each([
    ["cost", (f) => (f.context.expected_state[0].variant.cost_cents = 0)],
    ["price", (f) => (f.context.expected_state[0].variant.price_cents = 98001)],
    ["description", (f) => (f.after[0].fields["descripción *"] = "CHANGED")],
    ["secondary", (f) => (f.after[0].fields.precio2 = "5")],
    ["stock", (f) => (f.after[0].fields.existencia = "4")],
    ["code whitespace", (f) => (f.after[0].barcode += " ")],
    ["source incomplete", (f) => delete f.after[0].fields.unidad],
    [
      "WooID",
      (f) =>
        (f.context.expected_state[0].variant.woocommerce_product_id = 20470),
    ],
    [
      "grouped",
      (f) =>
        (f.context.expected_state[0].provisional.grouping_status = "GROUPED"),
    ],
    [
      "web released",
      (f) => (f.context.expected_state[0].provisional.web_release = true),
    ],
    ["two variants", (f) => (f.context.expected_state[0].family_size = 2)],
    ["two bindings", (f) => (f.context.expected_state[0].code_bindings = 2)],
    [
      "projection",
      (f) => (f.context.expected_state[0].managed.source_row.price_cents = 1),
    ],
    [
      "parent changed",
      (f) =>
        (f.context.expected_state[0].provisional.original_product_id =
          uuid(500)),
    ],
    [
      "old evidence",
      (f) =>
        (f.context.expected_state[0].provisional.source_sha256 = "b".repeat(
          64,
        )),
    ],
    [
      "web draft",
      (f) => (f.context.expected_state[0].web.draft = { revision: 1 }),
    ],
    ["expired snapshot", (f) => (f.asOf = "2026-10-23T02:18:00.000Z")],
    ["wrong cut", (f) => (f.source_after_sha256 = "a".repeat(64))],
    ["missing row", (f) => f.context.expected_state.pop()],
    ["duplicate code", (f) => f.before.push(structuredClone(f.before[0]))],
  ])("rejects %s", (_label, change) => {
    const f = fixture();
    change(f);
    expect(() => prepareSicarPublicPrices(f)).toThrow();
  });
  it("does not convert additional changes into prices", () => {
    const f = fixture(),
      a = structuredClone(f.before[0]);
    a.barcode = "99999";
    a.fields["clave1 *"] = "99999";
    const b = structuredClone(a);
    b.fields["descripción *"] = "Different";
    b.description = "Different";
    f.before.push(a);
    f.after.push(b);
    const p = prepareSicarPublicPrices(f);
    expect(p.summary.other_changes_held).toBe(1);
    expect(p.payload.changes).toHaveLength(10);
    expect(p.held[0].barcode).toBe("99999");
  });
  it("never overwrites an existing dossier", async () => {
    const root = await mkdtemp(join(tmpdir(), "m9-price-unit-"));
    try {
      const f = fixture(),
        config = {
          inputs: {},
          metadata: {
            source_before_sha256: f.source_before_sha256,
            source_after_sha256: f.source_after_sha256,
            request_id: f.request_id,
            asOf: f.asOf,
          },
        };
      for (const k of ["before", "after", "context"]) {
        const path = join(root, k + ".json"),
          bytes = JSON.stringify(f[k]);
        await writeFile(path, bytes, { flag: "wx" });
        config.inputs[k] = { path, sha256: sha(bytes) };
      }
      const cp = join(root, "config.json");
      await writeFile(cp, JSON.stringify(config));
      const out = join(root, "out");
      await writeSicarPublicPricePlan(cp, out);
      const old = await readFile(join(out, "payload.json"));
      await expect(writeSicarPublicPricePlan(cp, out)).rejects.toMatchObject({
        code: "EEXIST",
      });
      expect(await readFile(join(out, "payload.json"))).toEqual(old);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
