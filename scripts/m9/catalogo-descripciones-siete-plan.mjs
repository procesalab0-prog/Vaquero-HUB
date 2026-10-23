import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stable } from "./woo-test/plan.mjs";

export const DESCRIPTION_CODES = Object.freeze([
  "18221",
  "18222",
  "18223",
  "18224",
  "18225",
  "18226",
  "18227",
]);
export const DESCRIPTION_SOURCE_ROWS_SHA =
  "0284d3e543eee30602ce9d2001afffb310df44299181dd0cbd0ee0eadedf60cb";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const same = (a, b) => stable(a) === stable(b);
const must = (ok, message) => {
  if (!ok) throw Error(message);
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function prepareSicarDescriptions({
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
    "DESCRIPTION_ORIGINAL_CUTS_REQUIRED",
  );
  must(uuid.test(request_id), "DESCRIPTION_REQUEST_UUID_REQUIRED");
  must(
    Array.isArray(before) &&
      Array.isArray(after) &&
      Array.isArray(context?.expected_state),
    "DESCRIPTION_ARRAYS_REQUIRED",
  );
  const observed = new Date(context.observed_at).toISOString();
  must(
    new Date(asOf).toISOString() === asOf &&
      Date.parse(asOf) >= Date.parse(observed) &&
      Date.parse(asOf) - Date.parse(observed) <= 15 * 60_000,
    "DESCRIPTION_STALE_CONTEXT",
  );
  must(
    same(
      context.expected_state.map((f) => f.barcode),
      DESCRIPTION_CODES,
    ),
    "DESCRIPTION_FIXED_SEVEN_REQUIRED",
  );
  const sources = DESCRIPTION_CODES.map((barcode) => {
    const os = before.filter((r) => r.barcode === barcode),
      ns = after.filter((r) => r.barcode === barcode);
    must(
      os.length === 1 && ns.length === 1,
      "DESCRIPTION_DUPLICATE_OR_MISSING_SOURCE",
    );
    for (const r of [os[0], ns[0]])
      must(
        r.barcode === r.fields?.["clave1 *"] &&
          r.description === r.fields["descripción *"] &&
          r.issues?.length === 0 &&
          r.commercial_checks?.length === 0 &&
          r.display_only !== true &&
          r.product_id === null &&
          r.variation_id === null &&
          r.candidate_product_ids?.length === 0 &&
          r.candidate_variation_ids?.length === 0,
        "DESCRIPTION_SOURCE_BLOCKED_OR_WOO",
      );
    const o = os[0].fields,
      n = ns[0].fields;
    must(
      same(Object.keys(o).sort(), Object.keys(n).sort()) &&
        same(
          Object.keys(o).filter((k) => o[k] !== n[k]),
          ["descripción *"],
        ),
      "DESCRIPTION_NON_TEXT_CHANGE",
    );
    return { barcode, before: o, after: n };
  });
  const source_rows_json = stable(sources);
  must(
    sha(source_rows_json) === DESCRIPTION_SOURCE_ROWS_SHA,
    "DESCRIPTION_LITERAL_SOURCE_SHA_CHANGED",
  );
  const changes = [];
  for (const f of context.expected_state) {
    const source = sources.find((s) => s.barcode === f.barcode),
      c = f.current;
    must(
      uuid.test(f.variant_id) &&
        uuid.test(f.product?.id) &&
        f.variant.id === f.variant_id &&
        f.variant.product_id === f.product.id &&
        f.managed.variant_id === f.variant_id &&
        f.managed.barcode === f.barcode &&
        same(f.managed.source_row, c) &&
        f.code_bindings === 1 &&
        f.barcodes.filter(
          (b) =>
            b.code === f.barcode &&
            b.variant_id === f.variant_id &&
            b.source === "SICAR",
        ).length === 1 &&
        f.family_size === 1 &&
        f.provisional?.grouping_status === "PROVISIONAL" &&
        f.provisional.web_release === false &&
        f.provisional.grouping_event_id === null &&
        f.provisional.original_product_id === f.product.id &&
        f.provisional.source_sha256 === f.managed.source_sha256 &&
        /^[a-f0-9]{64}$/.test(f.managed.source_sha256),
      "DESCRIPTION_IDENTITY_OR_PROVISIONAL_CHANGED",
    );
    must(
      c.description === source.before["descripción *"] &&
        f.details.source_description === c.description &&
        c.barcode === f.barcode &&
        c.department === source.before.departamento &&
        c.section === source.before.categoria &&
        c.price_cents === 650000 &&
        f.variant.price_cents === 650000 &&
        c.cost_cents === null &&
        f.variant.cost_cents === null &&
        same(c.attributes, {}) &&
        same(f.attributes, []) &&
        same(f.attribute_values, []) &&
        f.variant.woocommerce_product_id === null &&
        f.variant.woocommerce_variation_id === null &&
        c.woo_variation_id === null &&
        c.family_key?.startsWith("prov-") &&
        c.product_name ===
          source.before["descripción *"] + " [SICAR " + f.barcode + "]" &&
        f.product.name === c.product_name &&
        f.independent_parent.product_id === f.product.id &&
        f.independent_parent.family_key === c.family_key &&
        f.independent_parent.source_name === c.product_name,
      "DESCRIPTION_BASELINE_CHANGED",
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
      "DESCRIPTION_WEB_CONTEXT_CHANGED",
    );
    const original = f.provisional.source_evidence;
    must(
      original?.barcode === f.barcode &&
        original.fields?.["clave1 *"] === f.barcode &&
        original.fields["descripción *"] === c.description &&
        original.fields.departamento === c.department &&
        original.fields.categoria === c.section &&
        original.fields.precio1 === "6500" &&
        original.grouping_status === "PROVISIONAL" &&
        original.web_release === false,
      "DESCRIPTION_ORIGINAL_EVIDENCE_CHANGED",
    );
    changes.push({
      barcode: f.barcode,
      variant_id: f.variant_id,
      previous_description: source.before["descripción *"],
      new_description: source.after["descripción *"],
    });
  }
  const payload = {
    protocol: "m9-sicar-description-seven-1",
    project_id: "zsezjtswqeijboezvado",
    request_id,
    source_before_sha256,
    source_after_sha256,
    source_rows_json,
    source_rows_sha256: DESCRIPTION_SOURCE_ROWS_SHA,
    observed_at: observed,
    expected_state: context.expected_state,
    changes,
  };
  return {
    protocol: "m9-sicar-description-seven-plan-1",
    reviewed_at: asOf,
    summary: {
      literal_description_updates: 7,
      product_or_variant_creations: 0,
      product_name_changes: 0,
      stock_cost_price_woo_writes: 0,
      original_provenance_changed: false,
      other_existing_changes_held: 4,
      grouping_decisions_generated: 0,
      owner_approval_generated: false,
    },
    payload,
  };
}
export async function writeSicarDescriptionPlan(configPath, out) {
  const config = JSON.parse(await readFile(configPath, "utf8")),
    inputs = {};
  for (const [k, pin] of Object.entries(config.inputs)) {
    const bytes = await readFile(pin.path);
    must(sha(bytes) === pin.sha256, "DESCRIPTION_INPUT_SHA_CHANGED:" + k);
    inputs[k] = JSON.parse(bytes);
  }
  const plan = prepareSicarDescriptions({ ...inputs, ...config.metadata });
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
      await writeSicarDescriptionPlan(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
