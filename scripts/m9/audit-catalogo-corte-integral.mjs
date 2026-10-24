import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditStagedCatalog } from "./audit-staged-catalog.mjs";
import { HELD_REASONS } from "./catalogo-retenidos-plan.mjs";
import { publicPriceCents } from "./catalogo-precios-corte-plan.mjs";
import { digest } from "./acceleration.mjs";
import {
  decodeCoveragePage,
  decodeCoverageAudit,
  decodeCoverageJSON,
  assembleCatalogCoverage,
  byteOrder,
} from "./catalogo-cobertura-pages.mjs";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const needed = (ok, message) => {
  if (!ok) throw Error(message);
};
const stable = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => byteOrder(a, b)),
        )
      : x,
  );
const count = (rows, key) =>
  Object.fromEntries(
    [
      ...rows.reduce(
        (m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1),
        new Map(),
      ),
    ].sort(([a], [b]) => byteOrder(a, b)),
  );

// Composes the existing auditor with a complete observed snapshot. It cannot
// create an approval, row postimage, SQL payload, stock or catalogue association.
export function auditCompleteCatalogEvidence({
  snapshot,
  source,
  heldPlan,
  previous,
  tableAudit,
  photos = null,
}) {
  needed(
    source.length === 16396 &&
      new Set(source.map((r) => r.barcode)).size === source.length &&
      source.every(
        (r) =>
          typeof r.barcode === "string" &&
          r.barcode.length > 0 &&
          r.barcode === r.fields?.["clave1 *"] &&
          r.description === r.fields?.["descripción *"],
      ),
    "COMPLETE_LITERAL_SICAR22_REQUIRED",
  );
  needed(
    snapshot.rows.length === 15961 &&
      snapshot.evidence_window.table_audits_equal === true,
    "COMPLETE15961_NATIVE_READ_REQUIRED",
  );
  const sourceMap = new Map(source.map((r) => [r.barcode, r])),
    loaded = new Map(snapshot.rows.map((r) => [r.barcode, r]));
  needed(
    loaded.size === snapshot.rows.length &&
      [...loaded.keys()].every((k) => sourceMap.has(k)),
    "NATIVE_CODES_NOT_UNIQUE_OR_OUTSIDE_SOURCE",
  );
  const absent = source
    .filter((r) => !loaded.has(r.barcode))
    .map((r) => r.barcode)
    .sort(byteOrder);
  const held = [...heldPlan.held].sort((a, b) =>
    byteOrder(a.barcode, b.barcode),
  );
  needed(
    absent.length === 435 &&
      stable(absent) === stable(held.map((r) => r.barcode)) &&
      heldPlan.source_sha256 ===
        "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93" &&
      heldPlan.source_rows_sha256 === digest(source) &&
      held.every(
        (r) =>
          Array.isArray(r.reasons) &&
          r.reasons.length > 0 &&
          new Set(r.reasons).size === r.reasons.length &&
          r.reasons.every((k) => HELD_REASONS.includes(k)),
      ),
    "EXACT435_HELD_PARTITION_REQUIRED",
  );
  const unavailable = snapshot.rows.filter(
    (r) =>
      !r.current ||
      typeof r.current.barcode !== "string" ||
      r.current.barcode !== r.barcode,
  );
  const available = snapshot.rows.filter((r) => !unavailable.includes(r));
  const legacy = auditStagedCatalog({ ...snapshot, rows: available }, source);
  const results = legacy.results.map((r) => {
    const native = loaded.get(r.barcode),
      reasons = [...r.reasons];
    if (native.barcode_binding_count !== 1)
      reasons.push("SICAR_PRIMARY_BINDING_NOT_UNIQUE");
    if (native.variant_active !== true || native.product_active !== true)
      reasons.push("NATIVE_VARIANT_OR_PRODUCT_INACTIVE");
    if (native.unit_code !== "PIECE") reasons.push("NATIVE_UNIT_NOT_PIECE");
    return {
      ...r,
      reasons: [...new Set(reasons)].sort(),
      state:
        reasons.length || r.differences.length
          ? "REVIEW_REQUIRED"
          : "EXACT_SOURCE_MATCH",
    };
  });
  for (const r of unavailable)
    results.push({
      barcode: r.barcode,
      variant_id: r.variant_id,
      product_id: r.product_id,
      state: "REVIEW_REQUIRED",
      reasons: ["NATIVE_CURRENT_PROJECTION_MISSING_OR_MANAGED_CODE_DIFFERS"],
      differences: [],
    });
  results.sort((a, b) => byteOrder(a.barcode, b.barcode));
  const oldIds = new Set(),
    oldCodes = new Set(),
    uuidChanges = [],
    uuidMissing = [];
  let uuidPreserved = 0;
  needed(
    previous.project_id === snapshot.project_id &&
      Array.isArray(previous.rows) &&
      previous.rows.length > 0,
    "PREVIOUS_UUID_SNAPSHOT_REQUIRED",
  );
  for (const r of previous.rows) {
    needed(
      !oldIds.has(r.variant_id) && !oldCodes.has(r.barcode),
      "PREVIOUS_UUID_SCOPE_DUPLICATE",
    );
    oldIds.add(r.variant_id);
    oldCodes.add(r.barcode);
    const live = loaded.get(r.barcode);
    if (!live) uuidMissing.push(r.barcode);
    else if (live.variant_id !== r.variant_id) {
      uuidChanges.push({
        barcode: r.barcode,
        previous_variant_id: r.variant_id,
        current_variant_id: live.variant_id,
      });
      const result = results.find((x) => x.barcode === r.barcode);
      result.reasons.push("UUID_CHANGED_SINCE_PRIOR_CAPTURE");
      result.state = "REVIEW_REQUIRED";
    } else uuidPreserved++;
  }
  const heldRows = held.map((h) => ({
    barcode: h.barcode,
    reasons: h.reasons,
    retail_source: sourceMap.get(h.barcode).fields.precio1,
    display_restricted: h.reasons.includes("DISPLAY_OR_SALES_RESTRICTION"),
    classification: h.reasons.includes("PUBLIC_PRICE_INVALID")
      ? sourceMap.get(h.barcode).fields.precio1 === "0"
        ? "ZERO_PRICE_REVIEW"
        : "RAW_PRICE_PRECISION_REVIEW_NO_ROUNDING"
      : "OTHER_HELD_REASON",
    import_allowed: false,
  }));
  const deltas = results.filter((r) => r.state !== "EXACT_SOURCE_MATCH");
  const priceCandidates = deltas.filter(
    (r) =>
      r.reasons.length === 0 &&
      r.differences.length === 1 &&
      r.differences[0].field === "price_cents" &&
      publicPriceCents(sourceMap.get(r.barcode).fields.precio1) !== null,
  );
  const nativeGuards = deltas.filter((r) => r.reasons.length > 0);
  const associations = deltas.filter((r) =>
    r.differences.some((d) =>
      ["attributes", "woo_product_id", "woo_variation_id"].includes(d.field),
    ),
  );
  const fields = [
    "barcode",
    "description",
    "department",
    "section",
    "price_cents",
    "attributes",
    "woo_product_id",
    "woo_variation_id",
  ];
  const comparisonFields = Object.fromEntries(
    fields.map((field) => {
      const changed = results.filter((r) =>
        r.differences.some((d) => d.field === field),
      ).length;
      return [
        field,
        {
          equal: available.length - changed,
          different: changed,
          unavailable: unavailable.length,
        },
      ];
    }),
  );
  const records = tableAudit.reduce((o, r) => ((o[r.name] = r), o), {});
  const photoSummary = {
    evidence_rows: records["app.web_variant_photo_evidence"]?.rows ?? null,
    copy_rows: records["app.web_variant_photo_storage"]?.rows ?? null,
    scope: "TABLE_COUNTS_ONLY",
    raw_bytes_reverified: false,
    commercial_eligibility_verified: false,
  };
  if (photos) {
    needed(
      photos.writes_performed === 0 &&
        photos.import_allowed === false &&
        photos.send_allowed === false &&
        photos.coverage?.linked_woo + photos.coverage?.sicar_only ===
          snapshot.rows.length &&
        Array.isArray(photos.gaps) &&
        photos.gaps.length === photos.coverage.without_evidence,
      "PHOTO_CENSUS_SCOPE_CHANGED",
    );
    const gaps = new Set();
    for (const row of photos.gaps) {
      needed(
        Array.isArray(row) &&
          row.length === 6 &&
          !gaps.has(row[0]) &&
          loaded.get(row[0])?.variant_id === row[1] &&
          loaded.get(row[0])?.product_id === row[2],
        "PHOTO_GAP_IDENTITY_CHANGED",
      );
      gaps.add(row[0]);
    }
    needed(
      photos.metadata.nonempty_evidence + 113 === photoSummary.evidence_rows,
      "PHOTO_EMPTY_EVIDENCE_SCOPE_CHANGED",
    );
    Object.assign(photoSummary, {
      scope: "CURRENT_READ_ONLY_GAP_CENSUS",
      coverage: photos.coverage,
      metadata: photos.metadata,
      empty_evidence_preserved_count: 113,
      empty_evidence_meaning: "PRESERVE_NO_AUTOFILL_NOT_SALE_APPROVAL",
    });
  }
  return {
    protocol: "m9-complete-catalog-evidence-audit-1",
    project_id: snapshot.project_id,
    mode: "READ_ONLY_NO_SQL_PAYLOAD",
    evidence_window: snapshot.evidence_window,
    summary: {
      source_codes: source.length,
      loaded_codes: snapshot.rows.length,
      held_codes: absent.length,
      presence_percent: Number(
        ((snapshot.rows.length * 100) / source.length).toFixed(2),
      ),
      presence_is_not_global_migration: true,
      exact_source_rows: results.length - deltas.length,
      review_rows: deltas.length,
      unavailable_current_projections: unavailable.length,
      price_only_candidates_for_protected_preflight: priceCandidates.length,
      uuid_compared: previous.rows.length,
      uuid_preserved: uuidPreserved,
      uuid_missing: uuidMissing.length,
      uuid_changed: uuidChanges.length,
      additional_observed_uuid_rows:
        snapshot.rows.length - uuidPreserved - uuidChanges.length,
      inventory_balances: snapshot.inventory_balances,
      inventory_movements: snapshot.inventory_movements,
    },
    difference_combinations: count(deltas, (r) =>
      [...r.reasons, ...r.differences.map((d) => "FIELD:" + d.field)]
        .sort()
        .join("|"),
    ),
    held: {
      reason_counts: Object.fromEntries(
        HELD_REASONS.map((k) => [
          k,
          heldRows.filter((r) => r.reasons.includes(k)).length,
        ]),
      ),
      combinations: count(heldRows, (r) => [...r.reasons].sort().join("|")),
      price_invalid_kinds: count(
        heldRows.filter((r) => r.reasons.includes("PUBLIC_PRICE_INVALID")),
        (r) => r.classification,
      ),
      rows: heldRows,
    },
    uuid_preservation: {
      changed: uuidChanges,
      missing: uuidMissing,
      scope:
        "OLDER_OBSERVED_UUIDS_ONLY_NEW_UUIDS_ARE_NEWLY_OBSERVED_NOT_RECONSTRUCTED",
    },
    comparison_interpretation: {
      fields: comparisonFields,
      differences_are_not_operational_blocks: true,
      owner_questions_generated: 0,
      source_attributes_and_woo_are_complementary_projections: true,
      commercial_or_grouping_approval_evaluated: false,
      explanation:
        "Only literal source comparison; derived native attributes and source Woo candidates cannot replace prior grouping or authorize a Woo association.",
    },
    price_preflight_candidates: priceCandidates.map((r) => ({
      barcode: r.barcode,
      variant_id: r.variant_id,
      product_id: r.product_id,
      current_cents: loaded.get(r.barcode).current.price_cents,
      source_price_literal: sourceMap.get(r.barcode).fields.precio1,
      proposed_cents: publicPriceCents(sourceMap.get(r.barcode).fields.precio1),
      original_source_sha256: loaded.get(r.barcode).source_sha256,
      observed_native_woo_product_id: loaded.get(r.barcode)
        .native_woo_product_id,
      observed_native_woo_variation_id: loaded.get(r.barcode)
        .native_woo_variation_id,
      complete_price_writer_state_captured: false,
      operational_permissions_or_web_eligibility_verified: false,
      mutation_payload: false,
      auto_apply: false,
    })),
    photos: photoSummary,
    results,
    technical_queue: [
      {
        kind: "NATIVE_GUARDS_OR_IDENTITY",
        codes: nativeGuards.map((r) => r.barcode),
        auto_apply: false,
      },
      {
        kind: "PRICE_ONLY_PROTECTED_PREFLIGHT_CANDIDATES",
        codes: priceCandidates.map((r) => r.barcode),
        auto_apply: false,
      },
      {
        kind: "SOURCE_ATTRIBUTE_OR_WOO_PROVENANCE_REVIEW",
        codes: associations.map((r) => r.barcode),
        auto_apply: false,
      },
      {
        kind: "OTHER_SOURCE_DIFFERENCES",
        codes: deltas
          .filter(
            (r) =>
              !nativeGuards.includes(r) &&
              !priceCandidates.includes(r) &&
              !associations.includes(r),
          )
          .map((r) => r.barcode),
        auto_apply: false,
      },
    ],
    limits: [
      "Per-page read transactions with equal before/after table audits; not a single simultaneous cut.",
      "SICAR reconciliation attributes may originate in Woo; differences do not authorize replacing approved SICAR-only grouping.",
      "Photo evidence/copy/metadata is not commercial eligibility or a new byte verification.",
      "No source absence authorizes deletion and no retained code, cost, stock or price is guessed.",
    ],
    write_allowed: false,
    production_allowed: false,
    inventory_operations: 0,
  };
}

export function prepareCompleteCatalogAudit(configPath, out) {
  const cfg = JSON.parse(readFileSync(configPath)),
    inputs = {},
    pins = {};
  needed(
    cfg.project_id === "zsezjtswqeijboezvado" &&
      cfg.mode === "READ_ONLY_COMPLETE_CATALOG_AUDIT" &&
      Array.isArray(cfg.pages) &&
      cfg.pages.length > 0,
    "PINNED_CATALOG_CONFIG_REQUIRED",
  );
  const load = (name, p) => {
    needed(
      p && typeof p.path === "string" && /^[a-f0-9]{64}$/.test(p.sha256 ?? ""),
      "PIN_REQUIRED:" + name,
    );
    const raw = readFileSync(resolve(dirname(configPath), p.path));
    needed(sha(raw) === p.sha256, "INPUT_CHANGED:" + name);
    pins[name] = { ...p };
    return JSON.parse(raw);
  };
  for (const n of [
    "source",
    "held_plan",
    "previous",
    "before_audit",
    "after_audit",
  ])
    inputs[n] = load(n, cfg.inputs[n]);
  const before = decodeCoverageAudit(inputs.before_audit),
    after = decodeCoverageAudit(inputs.after_audit);
  const pages = cfg.pages.map((p, i) =>
    decodeCoveragePage(load("page_" + i, p)),
  );
  const snapshot = assembleCatalogCoverage(pages, before, after);
  const photos = cfg.inputs.photos
    ? decodeCoverageJSON(load("photos", cfg.inputs.photos))[0].census
    : null;
  const result = auditCompleteCatalogEvidence({
    snapshot,
    source: inputs.source,
    heldPlan: inputs.held_plan,
    previous: inputs.previous,
    tableAudit: after,
    photos,
  });
  const files = {
    "auditoria.json": JSON.stringify(result, null, 2) + "\n",
    "resumen.json":
      JSON.stringify(
        {
          ...result.summary,
          held_reason_counts: result.held.reason_counts,
          photo_scope: result.photos.scope,
          write_allowed: false,
        },
        null,
        2,
      ) + "\n",
  };
  mkdirSync(out, { mode: 0o700 });
  for (const [n, content] of Object.entries(files))
    writeFileSync(join(out, n), content, { mode: 0o600, flag: "wx" });
  writeFileSync(
    join(out, "manifest.json"),
    JSON.stringify(
      {
        protocol: "m9-complete-catalog-evidence-manifest-1",
        inputs: pins,
        files: Object.fromEntries(
          Object.entries(files).map(([n, v]) => [n, sha(v)]),
        ),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return result.summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  needed(process.argv.length === 4, "Usage: PINNED_CONFIG NEW_OUTPUT");
  console.log(
    JSON.stringify(
      prepareCompleteCatalogAudit(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
