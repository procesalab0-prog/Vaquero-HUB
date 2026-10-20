import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { digest } from "../../scripts/m9/acceleration.mjs";
import {
  pilotTransactionalRehearsal,
  preparePilotTransactionalRehearsal,
} from "../../scripts/m9/pilot-transactional-rehearsal.mjs";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const location = "467765fe-d18e-43bb-be68-326adbf05ce1";
function fixture() {
  const o = { barcode: "0002396", observed_label: "ALMACENES\n2 PZA" },
    observationsRaw = JSON.stringify([o]);
  const row = {
    barcode: "0002396",
    variant_id: "6da4feb2-7146-4d4d-b865-6af14cc02a9b",
    product_id: "eae132eb-8111-418a-b30c-86a199934e62",
    observed_source_qty: "2",
    observation_sha256: digest(o),
    physical_qty: null,
    reserved_qty: null,
    available_qty: null,
    cost_cents: null,
    import_allowed: false,
  };
  const tables = [
    "public.variants",
    "public.products",
    "public.barcodes",
    "public.inventory_by_location",
    "public.inventory_movements",
    "public.sales",
    "public.sale_items",
    "public.sale_payments",
    "public.cash_movements",
    "public.returns",
    "public.return_items",
    "public.return_payments",
    "app.supervisor_authorizations",
    "public.idempotency_keys",
    "public.folios",
    "public.audit_log",
    "app.m9_rehearsal_control",
    "app.m9_rehearsal_allowlist",
  ];
  return {
    observationsRaw,
    review: {
      version: "m9-sicar-pilot-evidence-1",
      inputs: {
        observations: createHash("sha256")
          .update(observationsRaw)
          .digest("hex"),
      },
      mode: "OFFLINE_READ_ONLY",
      production_allowed: false,
      inventory_import_allowed: false,
      activation_allowed: false,
      source_observation_is_not_physical_count: true,
      identity_sha256: digest([
        {
          barcode: row.barcode,
          variant_id: row.variant_id,
          product_id: row.product_id,
        },
      ]),
      rows: [row],
    },
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      captured_at: "2026-10-20T03:00:00Z",
      control: { enabled: true },
      proposed_location_id: location,
      locations: [{ id: location, type: "STORE", is_active: true }],
      rows: [
        {
          ...row,
          current: { cost_cents: null, price_cents: 219000 },
          location_id: location,
          stored_matches: true,
          review_matches: true,
          barcode_matches: true,
          is_active: true,
          unit_code: "PIECE",
          balance_present: false,
          qty: null,
          reserved_qty: null,
        },
      ],
      audit: Object.fromEntries(
        tables.map((t) => [
          t,
          { count: 0, md5: "d41d8cd98f00b204e9800998ecf8427e" },
        ]),
      ),
    },
  };
}
const run = (f) =>
  pilotTransactionalRehearsal(f.review, f.snapshot, f.observationsRaw);
it("confines sales and supervisor fixtures to rollback and tests existing engines", () => {
  const sql = run(fixture());
  expect(sql.match(/\bbegin;/g)).toHaveLength(1);
  expect(sql.match(/\brollback;/g)).toHaveLength(1);
  expect(sql).toMatch(/rollback;\n$/);
  expect(sql).not.toMatch(
    /\bcommit;|disable trigger|set enabled=false|delete from|truncate/i,
  );
  for (const s of [
    "public.resolve_pos_scan",
    "public.create_sale",
    "public.get_sale_receipt",
    "public.create_return_exchange",
    "RETURN_AUTHORIZATION_REQUIRED",
    "IDEMPOTENCY_CONFLICT",
    "INSUFFICIENT_STOCK",
    "OUTSIDE_PILOT_SELLABLE",
    "M9_VARIANT_PENDING_REVIEW",
    "CASH_NOT_NEUTRAL",
    "set constraints all immediate",
    "0002396",
    "'real_pin_acceptance',false",
    "'source_stock_approved',false",
  ])
    expect(sql).toContain(s);
});
it.each([
  0,
  -1,
  1.5,
  null,
  NaN,
  Infinity,
  Number.MAX_SAFE_INTEGER + 1,
  Number.MAX_SAFE_INTEGER,
  "219000",
])("rejects unsafe price %s", (price) => {
  const f = fixture();
  f.snapshot.rows[0].current.price_cents = price;
  expect(() => run(f)).toThrow("EXACT_POSITIVE_PILOT_PRICE_REQUIRED");
});
it.each([
  (f) => (f.snapshot.project_id = "drubkjlmfbdeglucakmg"),
  (f) => (f.review.production_allowed = true),
  (f) => (f.review.activation_allowed = true),
  (f) => (f.review.inventory_import_allowed = true),
  (f) => (f.review.rows[0].reserved_qty = "0"),
  (f) => (f.snapshot.audit["public.sales"] = null),
  (f) => (f.observationsRaw += " "),
])("inherits strict source, audit and staging controls", (change) => {
  const f = fixture();
  change(f);
  expect(() => run(f)).toThrow();
});
it("keeps transaction composition fixed", () => {
  const sql = run(fixture());
  expect(sql.indexOf("LEDGER_BASELINE_CHANGED")).toBeLessThan(
    sql.indexOf("public.create_sale("),
  );
  expect(sql).toContain("lock table public.cash_sessions");
  expect(sql).toContain("'auth_postgrest_acceptance',false");
  expect(sql.indexOf("set constraints all deferred;")).toBeLessThan(
    sql.indexOf("create temporary table pilot_flow_result"),
  );
});

it.each([
  { batchIndex: -1 },
  { batchIndex: 1 },
  { batchIndex: 0.5 },
  { batchSize: 0 },
  { batchSize: 4 },
  { batchSize: 1.5 },
])("rejects invalid or unbounded batches %j", (options) => {
  const f = fixture();
  expect(() =>
    pilotTransactionalRehearsal(
      f.review,
      f.snapshot,
      f.observationsRaw,
      options,
    ),
  ).toThrow("BOUNDED_QA_BATCH_REQUIRED");
});
it("protects the second SQL body delimiter in literal codes", () => {
  const f = fixture(),
    code = "000$flow$2396",
    o = { barcode: code, observed_label: "ALMACENES\n2 PZA" };
  f.observationsRaw = JSON.stringify([o]);
  f.review.inputs.observations = createHash("sha256")
    .update(f.observationsRaw)
    .digest("hex");
  f.review.rows[0].barcode = code;
  f.review.rows[0].observation_sha256 = digest(o);
  f.snapshot.rows[0].barcode = code;
  f.review.identity_sha256 = digest(
    f.review.rows.map(({ barcode, variant_id, product_id }) => ({
      barcode,
      variant_id,
      product_id,
    })),
  );
  expect(() => run(f)).toThrow("UNSAFE_DO_DELIMITER");
});
async function diskFixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "m9-flow-unit-"));
  try {
    const f = fixture(),
      raw = {
        review: JSON.stringify(f.review),
        snapshot: JSON.stringify(f.snapshot),
        observations: f.observationsRaw,
      },
      config = {};
    for (const [key, bytes] of Object.entries(raw)) {
      await writeFile(join(dir, key + ".json"), bytes);
      config[key] = {
        path: key + ".json",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }
    await writeFile(join(dir, "config.json"), JSON.stringify(config));
    await fn(dir, config);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
it("repeats offline preparation byte for byte and refuses to overwrite evidence", async () =>
  diskFixture(async (dir) => {
    const a = await preparePilotTransactionalRehearsal(
      join(dir, "config.json"),
      join(dir, "run1"),
    );
    const b = await preparePilotTransactionalRehearsal(
      join(dir, "config.json"),
      join(dir, "run2"),
    );
    expect(a).toEqual(b);
    for (const file of ["tanda-1.sql", "plan.json", "sha256.json"])
      expect(await readFile(join(dir, "run1", file), "utf8")).toBe(
        await readFile(join(dir, "run2", file), "utf8"),
      );
    await expect(
      preparePilotTransactionalRehearsal(
        join(dir, "config.json"),
        join(dir, "run1"),
      ),
    ).rejects.toThrow();
  }));
it("rejects changed input bytes before writing any output", async () =>
  diskFixture(async (dir) => {
    await writeFile(join(dir, "snapshot.json"), "{}");
    await expect(
      preparePilotTransactionalRehearsal(
        join(dir, "config.json"),
        join(dir, "out"),
      ),
    ).rejects.toThrow("FLOW_INPUT_HASH_CHANGED: snapshot");
    await expect(access(join(dir, "out"))).rejects.toThrow();
  }));
it("rejects an input without its pinned digest", async () =>
  diskFixture(async (dir, config) => {
    delete config.review.sha256;
    await writeFile(join(dir, "config.json"), JSON.stringify(config));
    await expect(
      preparePilotTransactionalRehearsal(
        join(dir, "config.json"),
        join(dir, "out"),
      ),
    ).rejects.toThrow("PINNED_FLOW_INPUT_REQUIRED: review");
  }));
