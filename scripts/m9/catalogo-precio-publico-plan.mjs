import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogoPreciosCortePlan } from "./catalogo-precios-corte-plan.mjs";
import { stable } from "./woo-test/plan.mjs";
export const PRICE_CODES = Object.freeze([
  "11425",
  "11426",
  "11427",
  "11428",
  "11429",
  "11430",
  "12232",
  "12233",
  "12235",
  "12236",
]);
const sha = (x) => createHash("sha256").update(x).digest("hex"),
  same = (a, b) => stable(a) === stable(b),
  must = (a, b) => {
    if (!a) throw Error(b);
  };
export function prepareSicarPublicPrices({
  before,
  after,
  context,
  source_before_sha256,
  source_after_sha256,
  request_id,
  asOf,
}) {
  must(
    source_before_sha256 ===
      "33b1d36200f8db0eecf0cd1fbdd1c76400ee291d747348a6c87881f39043cc44" &&
      source_after_sha256 ===
        "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93",
    "ORIGINAL_SICAR_CUTS_REQUIRED",
  );
  must(
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request_id),
    "PRICE_REQUEST_UUID_REQUIRED",
  );
  const snapshot = {
    version: "m9-catalog-price-snapshot-1",
    project_id: "zsezjtswqeijboezvado",
    observed_at: new Date(context.observed_at).toISOString(),
    mode: "READ_ONLY_SELECT",
    rows: context.expected_state.map((f) => ({
      barcode: f.barcode,
      variant_id: f.variant_id,
      product_id: f.variant.product_id,
      source_sha256: f.managed.source_sha256,
      source_row: f.managed.source_row,
      current_row: f.current,
      barcode_bindings: f.code_bindings,
      barcode_variant_id: f.barcodes.find((b) => b.code === f.barcode)
        ?.variant_id,
      price_cents: f.variant.price_cents,
      cost_cents: f.variant.cost_cents,
      woo_product_id: f.variant.woocommerce_product_id,
      woo_variation_id: f.variant.woocommerce_variation_id,
    })),
  };
  const plan = catalogoPreciosCortePlan(before, after, snapshot, asOf);
  const selected = plan.records.filter((r) => PRICE_CODES.includes(r.barcode));
  must(
    same(
      selected.map((r) => r.barcode),
      PRICE_CODES,
    ) &&
      same(
        context.expected_state.map((f) => f.barcode),
        PRICE_CODES,
      ),
    "FIXED_TEN_PRICE_ROWS_REQUIRED",
  );
  must(
    selected.every(
      (r) =>
        same(r.changed_fields, ["precio1"]) &&
        same(r.reasons, ["WOO_CONTEXT_REQUIRES_SEPARATE_REVIEW"]) &&
        r.previous_public_cents === 98000 &&
        r.proposed_public_cents === 115000 &&
        !r.observed_stock_change_excluded,
    ),
    "NON_PRICE_CHANGE_OR_BASELINE_DRIFT",
  );
  for (const f of context.expected_state) {
    must(
      f.variant.woocommerce_product_id === null &&
        f.variant.woocommerce_variation_id === null &&
        f.family_size === 1 &&
        f.code_bindings === 1 &&
        f.provisional?.web_release === false &&
        f.provisional.grouping_status === "PROVISIONAL" &&
        f.provisional.original_product_id === f.product.id &&
        f.provisional.source_sha256 === f.managed.source_sha256 &&
        same(f.managed.source_row, f.current),
      "PROVISIONAL_OR_CATALOG_CHANGED",
    );
    must(
      same(f.web, {
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
      }),
      "WEB_CONTEXT_CHANGED_REVIEW_REQUIRED",
    );
  }
  const sourceRows = PRICE_CODES.map((barcode) => ({
    barcode,
    before: before.find((r) => r.barcode === barcode),
    after: after.find((r) => r.barcode === barcode),
  }));
  must(
    sourceRows.every(
      (r) =>
        r.before.fields.precio1 === "980" && r.after.fields.precio1 === "1150",
    ),
    "LITERAL_PRICE_FIELDS_CHANGED",
  );
  const source_rows_json = JSON.stringify(sourceRows);
  const payload = {
    protocol: "m9-sicar-public-price-1",
    project_id: "zsezjtswqeijboezvado",
    request_id,
    source_before_sha256,
    source_after_sha256,
    source_rows_json,
    source_rows_sha256: sha(source_rows_json),
    observed_at: snapshot.observed_at,
    expected_state: context.expected_state,
    changes: selected.map((r) => ({
      barcode: r.barcode,
      variant_id: r.preconditions.variant_id,
      previous_cents: r.previous_public_cents,
      new_cents: r.proposed_public_cents,
    })),
  };
  return {
    protocol: "m9-sicar-public-price-plan-1",
    summary: {
      price_updates_prepared: 10,
      other_changes_held: plan.records.length - 10,
      woo_writes: 0,
      stock_writes: 0,
      cost_writes: 0,
      source_raw_modified: false,
      web_release: false,
    },
    reviewed_at: asOf,
    held: plan.records.filter((r) => !PRICE_CODES.includes(r.barcode)),
    payload,
    owner_approval_generated: false,
    remote_writes_performed: 0,
  };
}
export async function writeSicarPublicPricePlan(configPath, out) {
  const config = JSON.parse(await readFile(configPath, "utf8")),
    inputs = {};
  for (const [k, pin] of Object.entries(config.inputs)) {
    const bytes = await readFile(pin.path);
    must(sha(bytes) === pin.sha256, "PRICE_INPUT_SHA_CHANGED:" + k);
    inputs[k] = JSON.parse(bytes);
  }
  const plan = prepareSicarPublicPrices({ ...inputs, ...config.metadata });
  await mkdir(out, { recursive: false, mode: 0o700 });
  for (const [name, value] of Object.entries({
    "plan.json": plan,
    "payload.json": plan.payload,
    "summary.json": plan.summary,
  }))
    await writeFile(resolve(out, name), JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  return plan.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4) throw Error("USAGE: CONFIG NEW_OUTPUT");
  console.log(
    JSON.stringify(
      await writeSicarPublicPricePlan(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
