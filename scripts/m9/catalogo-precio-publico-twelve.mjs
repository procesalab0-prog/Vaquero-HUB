// Narrow preparer extension; the installed price writer and journal own all DML.
import { createHash } from "node:crypto";
import { stable } from "./woo-test/plan.mjs";
export const TWELVE_PROTOCOL = "m9-sicar-public-price-provisional12-1";
export const TWELVE_CODES = Object.freeze(
  Array.from({ length: 12 }, (_, i) => String(3416 + i)),
);
export const TWELVE_SOURCE_SHA =
  "a6b575333386948af0ce6fb8053b11e42125d23ed483932755f5132a28c99984";
export const TWELVE_IDENTITY_SHA =
  "136ce60417d6aa4a157fc3a5820ce40350e9761732217e69c096a40bcbd26511";
export const ORIGINAL_PROVISIONAL_SHA =
  "3940d108da85729d074284f83e27f3ffe700d03818273c5f96bb087c73828d37";
export const PRICE_PREIMAGES = Object.freeze({
  "app.m9_apply_sicar_public_prices(jsonb)":
    "39f3584ee29a00c7baeb6df3d1f452279d7af33ee13b1e04962235a6563de367",
  "app.m9_reverse_sicar_public_prices(uuid,uuid)":
    "8d721d66d216a29afcdccc55f614c6b82533a0adc452822a08ba6c6c81f72892",
  "app.m9_sicar_linked_price_locks()":
    "03ca42cbf29f5c7877f6ea3b0ed44848d3943052a4177d147e9151d1bc726dae",
  "app.m9_sicar_linked_price_state(uuid[])":
    "4118db760b66ca276684233dda19cee35c186675ed55bb6a565bbbcbf432af1a",
  "app.m9_sicar_price_state(uuid[])":
    "7edf9f5b6b027278433392fe4bc27064bbc208e1fae8add34d0f84a39b1a7d9a",
  "app.m9_validate_linked_price_packet(jsonb)":
    "55751ccc5e3392bf6c9666e7bdce4a1fe48a1289befe5bd1c703c055dadc6b2b",
});
const sha = (x) => createHash("sha256").update(x).digest("hex"),
  same = (a, b) => stable(a) === stable(b),
  must = (v, m) => {
    if (!v) throw Error(m);
  };
const uuid = (x) =>
  typeof x === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    x,
  );
const emptyWeb = {
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
};
function utc(value) {
  must(typeof value === "string", "TWELVE_CANONICAL_DATE_REQUIRED");
  const m =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|\+00(?::00)?)$/.exec(
      value,
    );
  must(m, "TWELVE_CANONICAL_DATE_REQUIRED");
  const iso = `${m[1]}T${m[2]}.${(m[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  must(
    Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString() === iso,
    "TWELVE_CANONICAL_DATE_REQUIRED",
  );
  return iso;
}
export function prepareTwelveSicarPublicPrices({
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
    "TWELVE_ORIGINAL_CUTS_REQUIRED",
  );
  must(uuid(request_id), "TWELVE_REQUEST_UUID_REQUIRED");
  must(
    Array.isArray(before) &&
      Array.isArray(after) &&
      Array.isArray(context?.expected_state),
    "TWELVE_SOURCE_AND_STATE_REQUIRED",
  );
  const observed = utc(context.observed_at),
    reviewed = utc(asOf);
  must(
    reviewed === asOf &&
      Date.parse(reviewed) >= Date.parse(observed) &&
      Date.parse(reviewed) - Date.parse(observed) <= 15 * 60000,
    "TWELVE_STALE_CONTEXT",
  );
  const sourceRows = TWELVE_CODES.map((barcode) => {
    const o = before.filter((r) => r.barcode === barcode),
      n = after.filter((r) => r.barcode === barcode);
    must(
      o.length === 1 && n.length === 1,
      "TWELVE_UNIQUE_LITERAL_ROWS_REQUIRED",
    );
    for (const r of [o[0], n[0]])
      must(
        r.fields?.["clave1 *"] === barcode &&
          r.description === r.fields["descripción *"] &&
          r.fields.precio1 === "1990" &&
          r.classification === "SICAR_ONLY" &&
          r.product_id === null &&
          r.variation_id === null &&
          same(r.issues, []) &&
          same(r.commercial_checks, []) &&
          // SICAR_ONLY has no Woo display classification. Preserve UNKNOWN;
          // a price correction does not certify sellability or publication.
          r.display_only === null,
        "TWELVE_SOURCE_IDENTITY_REQUIRED",
      );
    must(same(o[0].fields, n[0].fields), "TWELVE_CURRENT_CUT_FIELDS_CHANGED");
    return { barcode, before: o[0].fields, after: n[0].fields };
  });
  const source_rows_json = stable(sourceRows);
  must(
    sha(source_rows_json) === TWELVE_SOURCE_SHA,
    "TWELVE_LITERAL_SOURCE_CHANGED",
  );
  const state = context.expected_state;
  must(
    same(
      state.map((f) => f.barcode),
      TWELVE_CODES,
    ) &&
      new Set(state.map((f) => f.variant_id)).size === 12 &&
      new Set(state.map((f) => f.product?.id)).size === 12,
    "TWELVE_INDEPENDENT_IDENTITIES_REQUIRED",
  );
  must(
    sha(
      state
        .map((f) => [f.barcode, f.variant_id, f.product?.id].join(":"))
        .join("|"),
    ) === TWELVE_IDENTITY_SHA,
    "TWELVE_FIXED_UUID_BINDINGS_REQUIRED",
  );
  for (let i = 0; i < 12; i++) {
    const f = state[i],
      n = sourceRows[i].after,
      p = f.provisional,
      original = p?.source_evidence;
    must(
      uuid(f.variant_id) &&
        uuid(f.product?.id) &&
        f.variant?.id === f.variant_id &&
        f.variant.product_id === f.product.id &&
        f.managed?.variant_id === f.variant_id &&
        f.managed.barcode === f.barcode &&
        same(f.managed.source_row, f.current) &&
        f.current.barcode === f.barcode &&
        f.variant.price_cents === 179000 &&
        f.current.price_cents === 179000 &&
        f.variant.cost_cents === null &&
        f.current.cost_cents === null &&
        f.variant.woocommerce_product_id === null &&
        f.variant.woocommerce_variation_id === null &&
        f.variant.is_active === true &&
        f.product.is_active === true &&
        f.product.measure_unit_code === "PIECE" &&
        f.family_size === 1 &&
        f.code_bindings === 1,
      "TWELVE_NATIVE_BASELINE_CHANGED",
    );
    must(
      f.managed.source_sha256 === ORIGINAL_PROVISIONAL_SHA &&
        p?.source_sha256 === ORIGINAL_PROVISIONAL_SHA &&
        p.variant_id === f.variant_id &&
        p.original_product_id === f.product.id &&
        p.web_release === false &&
        p.grouping_status === "PROVISIONAL" &&
        p.grouping_event_id === null &&
        original?.barcode === f.barcode &&
        original.web_release === false &&
        original.grouping_status === "PROVISIONAL" &&
        original.original_classification === "SICAR_ONLY" &&
        same(original.match_issues, []) &&
        same(original.candidate_woo_ids, []) &&
        original.fields?.precio1 === "1790" &&
        same({ ...original.fields, precio1: "1990" }, n),
      "TWELVE_ORIGINAL_PROVISIONAL_CHANGED",
    );
    must(
      f.current.description === n["descripción *"] &&
        f.current.department === n.departamento &&
        f.current.section === n.categoria &&
        f.details?.source_description === n["descripción *"] &&
        f.details.department === n.departamento &&
        f.details.section === n.categoria &&
        f.details.wholesale_cents === null &&
        f.details.medium_wholesale_cents === null &&
        f.independent_parent?.product_id === f.product.id &&
        f.independent_parent.family_key === f.current.family_key &&
        f.independent_parent.section === n.categoria &&
        same(f.attributes, []) &&
        same(f.attribute_values, []) &&
        same(f.current.attributes, {}),
      "TWELVE_SOURCE_PROJECTION_CHANGED",
    );
    must(
      Array.isArray(f.barcodes) &&
        f.barcodes.length === 1 &&
        f.barcodes[0].code === f.barcode &&
        f.barcodes[0].variant_id === f.variant_id &&
        f.barcodes[0].source === "SICAR" &&
        f.barcodes[0].is_primary === true &&
        same(f.web, emptyWeb),
      "TWELVE_BARCODE_OR_WEB_CHANGED",
    );
  }
  return {
    protocol: "m9-sicar-public-price-provisional12-plan-1",
    reviewed_at: asOf,
    summary: {
      price_updates_prepared: 12,
      independent_products_preserved: 12,
      source_price_changed_between_19_and_22: false,
      source_display_only_status: "UNKNOWN_PRESERVED",
      source_snapshot_updated: false,
      source_raw_modified: false,
      woo_writes: 0,
      stock_writes: 0,
      cost_writes: 0,
      web_release: false,
    },
    payload: {
      protocol: TWELVE_PROTOCOL,
      project_id: "zsezjtswqeijboezvado",
      request_id,
      source_before_sha256,
      source_after_sha256,
      source_rows_json,
      source_rows_sha256: sha(source_rows_json),
      observed_at: observed,
      expected_state: state,
      changes: state.map((f) => ({
        barcode: f.barcode,
        variant_id: f.variant_id,
        previous_cents: 179000,
        new_cents: 199000,
      })),
    },
    execution_authorized: false,
    sql_acceptance_passed: false,
    requires_isolated_SQL_acceptance_and_races: true,
    requires_fresh_runtime_context: true,
    owner_approval_generated: false,
    remote_writes_performed: 0,
  };
}

const codesSQL =
  "array[" + TWELVE_CODES.map((x) => "'" + x + "'").join(",") + "]";
export const TWELVE_PATCHES = Object.freeze({
  apply: [
    [
      "declare linked boolean:=",
      `declare twelve boolean:=coalesce(p->>'protocol'='${TWELVE_PROTOCOL}',false);linked boolean:=`,
      1,
    ],
    [
      " if linked then perform app.m9_validate_linked_price_packet(p);end if;",
      " if twelve then perform app.m9_validate_twelve_price_packet(p);end if;\n if linked then perform app.m9_validate_linked_price_packet(p);end if;",
      1,
    ],
    [
      "(not linked and p->>'protocol'is distinct from'm9-sicar-public-price-1')",
      "(not linked and not twelve and p->>'protocol'is distinct from'm9-sicar-public-price-1')",
      1,
    ],
    [
      "case when linked then 1 else 10 end",
      "case when twelve then 12 when linked then 1 else 10 end",
      4,
    ],
    [
      "case when linked then array['11777']else",
      `case when twelve then ${codesSQL} when linked then array['11777']else`,
      2,
    ],
    [
      " if linked then perform app.m9_sicar_linked_price_locks();else",
      " if linked or twelve then perform app.m9_sicar_linked_price_locks();else",
      1,
    ],
    [
      " if (p->>'observed_at')::timestamptz is null",
      " if twelve and((p->>'observed_at')::timestamptz>clock_timestamp()or(p->>'observed_at')::timestamptz<clock_timestamp()-interval'15 minutes')then raise exception 'SICAR_TWELVE_PRICE_CONTEXT_EXPIRED';end if;\n if (p->>'observed_at')::timestamptz is null",
      1,
    ],
    [" if not linked then\n", " if not linked and not twelve then\n", 1],
    [
      "case when linked then '830000'::jsonb else '115000'::jsonb end",
      "case when twelve then '199000'::jsonb when linked then '830000'::jsonb else '115000'::jsonb end",
      1,
    ],
  ],
  reverse: [
    [
      "declare linked boolean:=false;",
      "declare twelve boolean:=false;linked boolean:=false;",
      1,
    ],
    [
      " linked:=coalesce(prior.packet->>'protocol'='m9-sicar-public-price-linked-1',false);",
      ` twelve:=coalesce(prior.packet->>'protocol'='${TWELVE_PROTOCOL}',false);\n linked:=coalesce(prior.packet->>'protocol'='m9-sicar-public-price-linked-1',false);\n if twelve then perform app.m9_twelve_price_actor();end if;`,
      1,
    ],
    [
      " if linked then perform app.m9_sicar_linked_price_locks();else",
      " if linked or twelve then perform app.m9_sicar_linked_price_locks();else",
      1,
    ],
    [
      "case when linked then 1 else 10 end",
      "case when twelve then 12 when linked then 1 else 10 end",
      1,
    ],
  ],
});
export function patchTwelvePriceDefinitions(definitions) {
  const result = { ...definitions };
  for (const [sig, h] of Object.entries(PRICE_PREIMAGES))
    must(
      typeof definitions[sig] === "string" && sha(definitions[sig]) === h,
      "TWELVE_INSTALLED_PREIMAGE_CHANGED:" + sig,
    );
  for (const [k, sig] of [
    ["apply", "app.m9_apply_sicar_public_prices(jsonb)"],
    ["reverse", "app.m9_reverse_sicar_public_prices(uuid,uuid)"],
  ])
    for (const [from, to, count] of TWELVE_PATCHES[k]) {
      must(
        result[sig].split(from).length - 1 === count,
        "TWELVE_EXTENSION_TARGET_CHANGED",
      );
      result[sig] = result[sig].split(from).join(to);
    }
  return result;
}
