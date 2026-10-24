// Offline review of canonical matcher outputs. No matching, writer or DB client.
import { stable } from "./woo-test/plan.mjs";
import { byteOrder } from "./catalogo-cobertura-pages.mjs";
const must = (v, code) => {
  if (!v) throw Error(code);
};
const pair = (r) => ({
  product_id: r.product_id ?? null,
  variation_id: r.variation_id ?? null,
});
const key = (p) =>
  p.product_id === null ? null : `${p.product_id}:${p.variation_id}`;
const indexed = (rows, field, name) => {
  must(Array.isArray(rows), "MISSING_" + name);
  const m = new Map();
  for (const r of rows) {
    must(r && r[field] !== undefined && !m.has(r[field]), "DUPLICATE_" + name);
    m.set(r[field], r);
  }
  return m;
};
export function reviewWooPairChanges({
  before,
  after,
  wooBefore,
  wooAfter,
  snapshot,
  expectedCodes,
}) {
  const old = indexed(before, "barcode", "BEFORE_CODE"),
    next = indexed(after, "barcode", "AFTER_CODE"),
    wb = indexed(wooBefore, "id", "WOO_BEFORE_ID"),
    wa = indexed(wooAfter, "id", "WOO_AFTER_ID"),
    native = indexed(snapshot.rows, "barcode", "NATIVE_CODE");
  must(
    old.size === next.size &&
      snapshot.project_id === "zsezjtswqeijboezvado" &&
      snapshot.evidence_window.table_audits_equal === true,
    "SOURCE_OR_STAGING_SCOPE_CHANGED",
  );
  const ids = new Set();
  for (const r of native.values()) {
    must(
      typeof r.barcode === "string" &&
        r.barcode === r.current?.barcode &&
        r.barcode === r.stored?.barcode &&
        r.variant_id &&
        !ids.has(r.variant_id) &&
        Object.hasOwn(r, "native_woo_product_id") &&
        Object.hasOwn(r, "native_woo_variation_id"),
      "INCOMPLETE_NATIVE_IDENTITY",
    );
    ids.add(r.variant_id);
  }
  const changed = [];
  for (const r of next.values()) {
    const o = old.get(r.barcode);
    must(
      o &&
        typeof r.barcode === "string" &&
        r.barcode === r.fields?.["clave1 *"] &&
        r.description === r.fields?.["descripción *"] &&
        o.row === r.row &&
        o.description === r.description &&
        stable(o.fields) === stable(r.fields),
      "LITERAL_SICAR_SOURCE_DRIFT",
    );
    if (key(pair(o)) !== key(pair(r))) changed.push(r.barcode);
  }
  changed.sort(byteOrder);
  must(
    stable(changed) === stable([...expectedCodes].sort(byteOrder)),
    "EXACT_CHANGED_PAIR_SCOPE_REQUIRED",
  );
  const sourceClaims = new Map(),
    nativeClaims = new Map(),
    nativeParents = new Map();
  for (const r of next.values()) {
    const k = key(pair(r));
    if (k) sourceClaims.set(k, [...(sourceClaims.get(k) ?? []), r.barcode]);
  }
  for (const r of native.values()) {
    const p = {
        product_id: r.native_woo_product_id,
        variation_id: r.native_woo_variation_id,
      },
      k = key(p);
    if (k) {
      nativeClaims.set(k, [...(nativeClaims.get(k) ?? []), r]);
      nativeParents.set(p.product_id, [
        ...(nativeParents.get(p.product_id) ?? []),
        r,
      ]);
    }
  }
  const context = (products, productID, variationID) => {
    const p = products.get(productID);
    if (!p) return null;
    const v = p.variants.find((x) => x.id === (variationID ?? p.id));
    return {
      product_id: p.id,
      name: p.name,
      short_description_literal: p.short_description,
      base_from_existing_reader: p.base,
      type: p.type,
      status: p.status,
      issues: p.issues,
      variation: v
        ? {
            id: v.id,
            status: v.status,
            attributes: v.attributes,
            issues: v.issues,
          }
        : null,
    };
  };
  const rows = changed.map((barcode) => {
    const o = old.get(barcode),
      n = next.get(barcode),
      s = native.get(barcode);
    must(s, "CHANGED_CODE_NOT_IN_OBSERVED_STAGING");
    const op = pair(o),
      np = pair(n),
      sp = {
        product_id: s.native_woo_product_id,
        variation_id: s.native_woo_variation_id,
      };
    const contextID = np.product_id ?? op.product_id;
    const contextVar = np.variation_id ?? op.variation_id;
    const previous = context(wb, contextID, contextVar),
      current = context(wa, contextID, contextVar);
    const occupants = (nativeClaims.get(key(np)) ?? []).filter(
      (x) => x.barcode !== barcode,
    );
    const otherFamilies = (nativeParents.get(np.product_id) ?? []).filter(
      (x) => x.product_id !== s.product_id,
    );
    const canonicalClaims =
      np.product_id === null ? [] : (sourceClaims.get(key(np)) ?? []);
    const identityReasons = [];
    if (stable(s.current) !== stable(s.stored))
      identityReasons.push("NATIVE_PROJECTION_DIFFERS_FROM_MANAGED");
    if (np.product_id === null)
      identityReasons.push("NO_EXACT_PAIR_IN_NEW_RECONCILIATION");
    if (np.product_id !== null && stable(canonicalClaims) !== stable([barcode]))
      identityReasons.push("SOURCE_TARGET_NOT_UNIQUE");
    if (
      np.product_id !== null &&
      (![
        "EXACT_SIMPLE_BASE",
        "EXACT_ATTRIBUTE",
        "CONFIRMED_T_DOT",
        "CONFIRMED_SIZE_X_LENGTH",
        "EXPLICIT_LABELS",
      ].includes(n.matching_rule) ||
        stable(n.candidate_product_ids) !== stable([np.product_id]) ||
        stable(n.candidate_variation_ids) !==
          stable([np.variation_id ?? np.product_id]))
    )
      identityReasons.push("CANONICAL_EXACT_MATCH_EVIDENCE_INCOMPLETE");
    if (
      np.product_id !== null &&
      (!current ||
        current.status !== "publish" ||
        current.variation?.status !== "publish")
    )
      identityReasons.push("SOURCE_TARGET_NOT_PUBLISHED_OR_MISSING");
    if (
      np.product_id !== null &&
      (!current ||
        current.issues.length ||
        current.variation?.issues.length ||
        stable(current.variation?.attributes) !== stable(n.attributes))
    )
      identityReasons.push("SOURCE_TARGET_ATTRIBUTES_OR_STRUCTURE_CHANGED");
    if (occupants.length)
      identityReasons.push("TARGET_OCCUPIED_BY_OTHER_LITERAL_CODE");
    if (otherFamilies.length)
      identityReasons.push("PARENT_ALREADY_BOUND_TO_OTHER_NATIVE_FAMILY");
    let judgment = "REVISION",
      cause = "OTHER_REVIEW";
    if (!identityReasons.length && key(np) === key(sp)) {
      judgment = "MANTENER";
      cause = "ALREADY_NATIVE_PAIR_PUBLICATION_ONLY_REVIEW";
    } else if (
      !identityReasons.length &&
      sp.product_id === null &&
      n.classification === "MATCH_EXACT_VARIANT" &&
      n.manual_review === false &&
      n.issues.length === 0 &&
      n.commercial_checks.length === 0
    ) {
      judgment = "POSIBLE_PROPUESTA";
      cause =
        previous?.base_from_existing_reader !==
        current?.base_from_existing_reader
          ? "EXACT_BASE_CORRECTION_CANDIDATE"
          : "PUBLISHED_ATTRIBUTE_CANDIDATE";
    } else if (
      previous &&
      current &&
      previous.base_from_existing_reader !== current.base_from_existing_reader
    ) {
      cause = "BASE_REUSED_OR_CHANGED_KEEP_HISTORY";
    } else if (
      previous?.variation &&
      current?.variation &&
      stable(previous.variation.attributes) !==
        stable(current.variation.attributes)
    ) {
      cause = "EXACT_ATTRIBUTE_TEXT_CHANGED_KEEP_HISTORY";
    } else if (sp.product_id !== null) {
      cause = "EXISTING_LINK_KEEP_AND_REVIEW_SOURCE";
    }
    return {
      barcode,
      sicar_row: n.row,
      sicar_description: n.description,
      uuid: { variant_id: s.variant_id, product_id: s.product_id },
      original_source_sha256: s.source_sha256,
      reconciled_pair_before: op,
      reconciled_pair_after: np,
      observed_native_pair: sp,
      observed_native_attributes: s.current.attributes ?? null,
      canonical: {
        before: o.classification,
        after: n.classification,
        matching_rule: n.matching_rule ?? null,
        attributes: n.attributes,
        issues: n.issues,
        commercial_checks: n.commercial_checks,
      },
      Woo_source: { before: previous, after: current },
      judgment,
      cause,
      identity_reasons: identityReasons,
      target_occupants: occupants.map((x) => ({
        barcode: x.barcode,
        variant_id: x.variant_id,
        product_id: x.product_id,
      })),
      parent_other_native_families: otherFamilies.map((x) => ({
        barcode: x.barcode,
        variant_id: x.variant_id,
        product_id: x.product_id,
      })),
      prior_link_must_remain_untouched: true,
      commercial_eligibility_assessed: false,
      physical_identity_approved: false,
      source_stock_used_to_select_identity: false,
      requires_fresh_preconditions_before_any_future_plan: true,
      write_allowed: false,
      assignment_allowed: false,
      grouping_allowed: false,
      inventory_import_allowed: false,
    };
  });
  const grouped = new Map();
  for (const r of rows)
    grouped.set(r.cause, [...(grouped.get(r.cause) ?? []), r.barcode]);
  return {
    protocol: "m9-woo-pair-change-review-1",
    mode: "READ_ONLY_INERT_REVIEW_NOT_ASSIGNMENT",
    snapshot_window: snapshot.evidence_window,
    summary: {
      SICAR_rows: after.length,
      changed_pairs: rows.length,
      judgments: Object.fromEntries(
        ["MANTENER", "REVISION", "POSIBLE_PROPUESTA"].map((j) => [
          j,
          rows.filter((r) => r.judgment === j).length,
        ]),
      ),
      source_target_occupied_rows: rows.filter((r) => r.target_occupants.length)
        .length,
      parent_other_family_rows: rows.filter(
        (r) => r.parent_other_native_families.length,
      ).length,
      new_approvals: 0,
    },
    rows,
    groups: [...grouped]
      .sort(([a], [b]) => byteOrder(a, b))
      .map(([cause, codes]) => ({ cause, codes, automatic_resolution: false })),
    limits: [
      "Pre-export staging snapshot, not a new current reading or simultaneous cut.",
      "Canonical matcher output is evidence, not owner approval; publication does not authorize grouping or association.",
      "Existing reader provides base and exact attributes; no fuzzy names, accent stripping or stock inference.",
      "No old link is removed; a missing candidate does not authorize deletion or reassignment.",
    ],
    write_allowed: false,
    operational_payload_generated: false,
  };
}
