import { assert, hash, localStore } from "./plan.mjs";

const dates = new Set(["date_modified", "date_modified_gmt"]);
function withoutDates(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => !dates.has(key)),
  );
}
function resources(input) {
  localStore(input.store);
  assert(input.mode === "update" && input.target, "UPDATE_REQUIRED");
  const t = input.target;
  return [
    { path: `products/${t.product_id}`, snapshot: t.snapshot },
    ...(input.type === "variable"
      ? t.variants.map((v) => ({
          path: `products/${t.product_id}/variations/${v.id}`,
          snapshot: v.snapshot,
        }))
      : []),
  ];
}
function validateSnapshot(before, after) {
  assert(
    after &&
      before.id === after.id &&
      hash(withoutDates(before)) === hash(withoutDates(after)),
    "REVALIDATION_BUSINESS_CHANGE",
  );
  for (const key of dates)
    assert(
      typeof after[key] === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(after[key]) &&
        Number.isFinite(Date.parse(after[key] + "Z")),
      "REVALIDATION_INVALID_DATE",
    );
}

// Explicit supervised local receipt. Never edits the original evidence and
// never authorizes business-field differences or claims ABA protection.
export async function prepareRevalidation({
  input,
  previousEvidenceHash,
  reason,
  request,
}) {
  const result = {
    version: "m9-local-date-revalidation-1",
    previous_evidence_sha256: previousEvidenceHash,
    product_id: input.product_id,
    store_sha256: hash(input.store),
    target_sha256: hash(input.target),
    reason,
    resources: [],
  };
  for (const r of resources(input)) {
    const snapshot = await request("GET", r.path);
    validateSnapshot(r.snapshot, snapshot);
    result.resources.push({
      path: r.path,
      original_sha256: hash(r.snapshot),
      snapshot,
    });
  }
  applyRevalidation(input, result, previousEvidenceHash);
  return result;
}

export function applyRevalidation(input, record, previousEvidenceHash) {
  const expected = resources(input);
  assert(
    /^[a-f0-9]{64}$/.test(previousEvidenceHash ?? "") &&
      record?.version === "m9-local-date-revalidation-1" &&
      record.previous_evidence_sha256 === previousEvidenceHash &&
      record.product_id === input.product_id &&
      record.store_sha256 === hash(input.store) &&
      record.target_sha256 === hash(input.target) &&
      typeof record.reason === "string" &&
      record.reason.trim().length >= 10 &&
      record.reason.length <= 1000 &&
      Array.isArray(record.resources) &&
      record.resources.length === expected.length &&
      new Set(record.resources.map((r) => r.path)).size === expected.length,
    "REVALIDATION_BINDING_FAILED",
  );
  const output = structuredClone(input);
  for (const r of expected) {
    const fresh = record.resources.find((x) => x.path === r.path);
    assert(
      fresh?.original_sha256 === hash(r.snapshot),
      "REVALIDATION_BINDING_FAILED",
    );
    validateSnapshot(r.snapshot, fresh.snapshot);
    if (r.path === `products/${input.target.product_id}`)
      output.target.snapshot = structuredClone(fresh.snapshot);
    const variant = output.target.variants.find((v) => v.id === r.snapshot.id);
    if (variant) variant.snapshot = structuredClone(fresh.snapshot);
  }
  return output;
}
