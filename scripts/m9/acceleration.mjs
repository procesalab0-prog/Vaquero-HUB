import { createHash } from "node:crypto";
import { prepareSicarOnly } from "./prepare-sicar-only.mjs";
import { reviewSicarFamilies } from "./review-sicar-families.mjs";
import { prepareSicarBatches } from "./plan-sicar-only.mjs";
import { stable } from "./woo-test/plan.mjs";

export const digest = (v) =>
  createHash("sha256").update(stable(v)).digest("hex");
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nameKey = (s) =>
  s
    .toLowerCase()
    .replace(
      /[áéíóúüñ]/g,
      (c) => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" })[c],
    );
const text = (s, max) =>
  typeof s === "string" && s.length > 0 && s.length <= max && s === s.trim();
export const RULE = Object.freeze({
  id: "SICAR_LITERAL_T_SAME_PRICE_CLASS_V1",
  delimiter: "T.",
  size_pattern: "XS|S|M|L|XL|XXL|XXXL|[0-9]+([.][0-9]+)?",
  same_literal_base: true,
  same_public_price: true,
  same_department_section: true,
  distinct_sizes: true,
  complete_family: true,
  minimum_members: 2,
  unknown_cost: null,
  destination: "STAGING_ONLY",
  woo_publication: false,
});

// New, explicit policy. Does not alter legacy question answers or planner rules.
export function ruleCohort({
  rows,
  snapshot,
  taxonomy,
  holds = [],
  questions = [],
  sourceSha,
  seed,
}) {
  if (
    !/^[a-f0-9]{64}$/.test(sourceSha) ||
    !text(seed, 200) ||
    !Array.isArray(rows) ||
    !rows.length
  )
    throw Error("SOURCE_AND_SEED_REQUIRED");
  if (
    snapshot.codes?.length !==
    new Set(snapshot.codes?.map((x) => x.barcode)).size
  )
    throw Error("INVALID_DESTINATION_SCOPE");
  const all = new Map();
  for (const r of rows) {
    if (
      !text(r.barcode, 80) ||
      all.has(r.barcode) ||
      r.fields?.["clave1 *"] !== r.barcode ||
      r.fields?.["descripción *"] !== r.description
    )
      throw Error("SOURCE_LITERAL_IDENTITY_CHANGED");
    all.set(r.barcode, r);
  }
  const review = prepareSicarOnly(rows);
  review.sources = { sicar_sha256: sourceSha, rows_sha256: digest(rows) };
  const cases = reviewSicarFamilies(review).cases;
  const staged = new Set(snapshot.codes.map((x) => x.barcode));
  const names = new Set(snapshot.names.map(nameKey));
  const held = new Set(holds.map((x) => x.barcode));
  const taxHeld = new Set(
    taxonomy.paths.filter((x) => x.needs_review).flatMap((x) => x.barcodes),
  );
  const ownerHeld = new Set(
    questions
      .filter((q) => {
        const a = q.answers.at(-1);
        return (
          a && (a.choice !== "SAME_MODEL" || a.note?.trim() || a.name?.trim())
        );
      })
      .flatMap((q) => q.evidence.members.map((x) => x.barcode)),
  );
  const scope = new Map();
  for (const r of rows) {
    // Deliberately looser than the allowed grammar: a malformed/foreign sibling
    // must exclude a whole family instead of silently disappearing from it.
    const match = /^(.+)T\./.exec(r.description);
    if (match) scope.set(match[1], [...(scope.get(match[1]) ?? []), r.barcode]);
  }
  const eligible = [],
    excluded = [];
  for (const c of cases.filter((c) => c.kind === "EXPLICIT_T_PROPOSAL")) {
    const reasons = new Set(c.issues);
    if (c.members.some((m) => staged.has(m.barcode)))
      reasons.add("ALREADY_OR_PARTIALLY_STAGED");
    if (c.members.some((m) => held.has(m.barcode)))
      reasons.add("EXISTING_MANUAL_HOLD");
    if (c.members.some((m) => taxHeld.has(m.barcode)))
      reasons.add("TAXONOMY_PATH_REVIEW");
    if (c.members.some((m) => ownerHeld.has(m.barcode)))
      reasons.add("OWNER_EXCEPTION");
    if (c.product_name_proposed === "CAWRNIÑO3587")
      reasons.add("NAMED_EXCEPTION");
    if (names.has(nameKey(c.product_name_proposed)))
      reasons.add("DESTINATION_NAME_REVIEW");
    if (!text(c.product_name_proposed, 160)) reasons.add("PARENT_NAME_INVALID");
    if (c.members.length < 2) reasons.add("SINGLE_MEMBER_NO_GROUPING_NEEDED");
    if (new Set(c.members.map((m) => m.retail_source)).size !== 1)
      reasons.add("PUBLIC_PRICE_DIFFERS");
    if (
      c.members.some(
        (m) =>
          !/^(XS|S|M|L|XL|XXL|XXXL|\d+(?:\.\d+)?)$/.test(m.proposed.suffix),
      )
    )
      reasons.add("SIZE_GRAMMAR_REVIEW");
    if (rows.some((r) => r.description === c.product_name_proposed))
      reasons.add("BASE_RECORD_REVIEW");
    const codes = c.members.map((m) => m.barcode).sort(compare);
    if (
      stable(codes) !==
      stable([...(scope.get(c.product_name_proposed) ?? [])].sort(compare))
    )
      reasons.add("COMPLETE_FAMILY_SCOPE_REVIEW");
    for (const m of c.members)
      if (m.description !== c.product_name_proposed + "T." + m.proposed.suffix)
        reasons.add("LITERAL_RECONSTRUCTION_FAILED");
    const result = { ...c, issues: [...reasons].sort(compare) };
    (reasons.size ? excluded : eligible).push(result);
  }
  eligible.sort((a, b) => compare(a.case_id, b.case_id));
  const cohortSha = digest({
    rule: RULE,
    sourceSha,
    rows: digest(rows),
    families: eligible,
  });
  // Hash ranking is deterministic, independent of input order, without modulo bias.
  const sample = [...eligible]
    .sort((a, b) =>
      compare(digest([seed, a.case_id]), digest([seed, b.case_id])),
    )
    .slice(0, 20);
  // Additional risk examples never replace the reproducible random sample.
  const risks = [...eligible]
    .sort(
      (a, b) =>
        b.members.length - a.members.length || compare(a.case_id, b.case_id),
    )
    .slice(0, 3);
  return {
    version: "m9-rule-cohort-1",
    rule: RULE,
    source_sha256: sourceSha,
    source_rows_sha256: digest(rows),
    destination_sha256: digest(snapshot),
    cohort_sha256: cohortSha,
    seed,
    eligible,
    excluded,
    review,
    sample: sample.map((c) => ({
      case_id: c.case_id,
      evidence_sha256: c.evidence_sha256,
      title: c.product_name_proposed,
      members: c.members,
    })),
    risk_examples: risks.map((c) => c.case_id),
    summary: {
      source_rows: rows.length,
      staged_rows: staged.size,
      eligible_families: eligible.length,
      eligible_rows: eligible.reduce((n, c) => n + c.members.length, 0),
      excluded_families: excluded.length,
    },
    write_allowed: false,
    production_allowed: false,
    inventory_operations: 0,
  };
}

// A user's rule authorization and the technical sample review are distinct from
// an owner's family-by-family answer. Never manufacture SAME_MODEL answers.
export function authorizeRule(cohort, authorization, sampleReview) {
  if (
    authorization?.scope !== "STAGING_RULE_ONLY" ||
    !text(authorization.authority, 160) ||
    !text(authorization.statement, 2000) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(authorization.date)
  )
    throw Error("EXPLICIT_RULE_AUTHORIZATION_REQUIRED");
  const recomputed = digest({
    rule: RULE,
    sourceSha: cohort.source_sha256,
    rows: cohort.source_rows_sha256,
    families: cohort.eligible,
  });
  if (
    cohort.cohort_sha256 !== recomputed ||
    stable(cohort.rule) !== stable(RULE)
  )
    throw Error("COHORT_CHANGED");
  if (
    sampleReview?.cohort_sha256 !== cohort.cohort_sha256 ||
    sampleReview.sample_sha256 !== digest(cohort.sample) ||
    !text(sampleReview.reviewer, 160) ||
    sampleReview.kind !== "TECHNICAL_SOURCE_REVIEW" ||
    sampleReview.result !== "PASS"
  )
    throw Error("SAMPLE_REVIEW_REQUIRED");
  const evidence = {
    version: "m9-rule-authorization-1",
    authorization,
    sampleReview,
    rule: RULE,
    cohort_sha256: cohort.cohort_sha256,
    owners_confirmed_sample: false,
  };
  const decisionSha = digest(evidence);
  const decisions = cohort.eligible.map((c) => ({
    family_key: "sicar-" + c.case_id.slice(0, 40),
    product_name: c.product_name_proposed,
    evidence_sha256: c.evidence_sha256,
    members: c.members.map((m) => ({
      barcode: m.barcode,
      attributes: { TALLA: m.proposed.suffix },
    })),
    status: "approved",
    reviewer: sampleReview.reviewer,
    reviewed_at: authorization.date,
    reason: `STAGING_RULE_ONLY ${RULE.id}; user authority: ${authorization.authority}; decision_sha256=${decisionSha}; cohort=${cohort.cohort_sha256}; technical sample only, no owner answers inferred`,
  }));
  const batches = prepareSicarBatches(cohort.review, decisions, 100);
  return { evidence, decision_sha256: decisionSha, decisions, batches };
}

// Archiving is deliberately a read-only decision. Missing reports never mean 0.
export function activityPlan(codes, reports, { cutoff, from, locations }) {
  if (
    !Array.isArray(locations) ||
    !locations.length ||
    new Set(locations).size !== locations.length ||
    !Number.isFinite(Date.parse(cutoff)) ||
    !Number.isFinite(Date.parse(from)) ||
    Date.parse(cutoff) - Date.parse(from) < 365 * 86400000
  )
    throw Error("ACTIVITY_SCOPE_REQUIRED");
  if (
    codes.some((c) => !text(c.barcode, 80)) ||
    new Set(codes.map((c) => c.barcode)).size !== codes.length
  )
    throw Error("ACTIVITY_CODE_SCOPE_INVALID");
  const codeScope = digest(codes.map((c) => c.barcode).sort(compare));
  const kinds = ["stock", "sales", "commitments"];
  const complete = kinds.every(
    (k) =>
      reports[k]?.complete === true &&
      reports[k].cutoff === cutoff &&
      reports[k].code_scope_sha256 === codeScope &&
      Array.isArray(reports[k].locations) &&
      Array.isArray(reports[k].rows) &&
      stable([...reports[k].locations].sort()) ===
        stable([...locations].sort()) &&
      (k !== "sales" || reports[k].from === from),
  );
  const rows = codes.map((c) => {
    const evidence = Object.fromEntries(
      kinds.map((k) => [
        k,
        reports[k]?.rows?.filter((r) => r.barcode === c.barcode) ?? [],
      ]),
    );
    // Stock explicitly covers each location; sales/commitments may be sparse
    // only under the complete manifest, for all codes (never a filtered report).
    const stock = evidence.stock;
    const invalid =
      !complete ||
      !reports.sales?.all_codes ||
      !reports.commitments?.all_codes ||
      stock.length !== locations.length ||
      new Set(stock.map((x) => x.location)).size !== locations.length ||
      stock.some(
        (r) =>
          !locations.includes(r.location) ||
          typeof r.qty !== "number" ||
          !Number.isFinite(r.qty),
      ) ||
      evidence.sales.some(
        (r) =>
          !locations.includes(r.location) ||
          !Number.isFinite(r.sold) ||
          r.sold < 0 ||
          !Number.isFinite(r.returned) ||
          r.returned < 0,
      ) ||
      evidence.commitments.some(
        (r) =>
          !locations.includes(r.location) ||
          !Number.isFinite(r.qty) ||
          r.qty < 0,
      );
    let status = "ACTIVE_OR_REVIEW";
    if (invalid) status = "REPORTS_REQUIRED";
    else if (c.inventoriable !== true || stock.some((r) => r.qty < 0))
      status = "MANUAL_REVIEW";
    else if (
      stock.some((r) => r.qty > 0) ||
      evidence.sales.some((r) => r.sold > 0 || r.returned > 0) ||
      evidence.commitments.some((r) => r.qty > 0) ||
      c.open_woo_order === true ||
      c.open_woo_order == null
    )
      status = "ACTIVE_OR_REVIEW";
    else status = "ARCHIVE_CANDIDATE";
    return {
      barcode: c.barcode,
      status,
      archive_allowed: false,
      evidence_sha256: digest(evidence),
    };
  });
  return {
    version: "m9-activity-plan-1",
    cutoff,
    from,
    locations,
    reports_complete: complete,
    rows,
    source_scope_sha256: digest(codes),
    reports_sha256: digest(reports),
    write_allowed: false,
  };
}
