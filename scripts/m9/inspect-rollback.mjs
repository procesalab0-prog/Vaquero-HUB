import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, hash, localStore } from "./woo-test/plan.mjs";

const allowed = new Set([
  "name",
  "description",
  "short_description",
  "regular_price",
]);
const metadata = (row, key) => {
  const matches = (row.meta_data ?? []).filter((m) => m.key === key);
  assert(
    matches.length === 1 && typeof matches[0].value === "string",
    "UNIQUE_LITERAL_IDENTITY_REQUIRED",
  );
  return matches[0].value;
};
const identity = (row, kind) => ({
  id: row.id,
  sku: row.sku,
  ...(kind === "variant" || row.type === "simple"
    ? {
        barcode: metadata(row, "_mi_tienda_barcode"),
        variant_id: metadata(row, "_mi_tienda_variant_id"),
      }
    : {
        type: row.type,
        variants: [...(row.variations ?? [])].sort((a, b) => a - b),
      }),
  attributes: row.attributes,
});

// Evidence only. No network client, SQL, mutations, or executable rollback payload.
export function inspectRollback(input) {
  assert(
    input?.version === "m9-rollback-review-input-1",
    "INVALID_INPUT_VERSION",
  );
  const origin = localStore(input.store);
  assert(
    input.store.id === "m9-local-2026-10-02" &&
      origin === "http://127.0.0.1:9417",
    "LOCAL_REHEARSAL_ONLY",
  );
  assert(["parent", "variant"].includes(input.kind), "INVALID_RESOURCE_KIND");
  assert(
    Array.isArray(input.fields) &&
      input.fields.length > 0 &&
      new Set(input.fields).size === input.fields.length,
    "EXPLICIT_UNIQUE_FIELDS_REQUIRED",
  );
  assert(
    input.fields.every((f) => allowed.has(f)),
    "UNSUPPORTED_ROLLBACK_FIELD",
  );
  const snapshots = [input.before, input.applied, input.current];
  for (const row of snapshots) {
    assert(
      row &&
        Number.isSafeInteger(row.id) &&
        row.id > 0 &&
        typeof row.sku === "string" &&
        Array.isArray(row.attributes),
      "INVALID_SNAPSHOT",
    );
    assert(
      input.fields.every(
        (f) => Object.hasOwn(row, f) && typeof row[f] === "string",
      ),
      "MISSING_LITERAL_FIELD",
    );
    if (input.kind === "parent")
      assert(
        row.status === "draft" && ["simple", "variable"].includes(row.type),
        "DRAFT_PARENT_REQUIRED",
      );
  }
  if (input.kind === "variant") {
    assert(
      Number.isSafeInteger(input.parent_id) && input.parent_id > 0,
      "PARENT_BINDING_REQUIRED",
    );
    assert(
      Array.isArray(input.parent_snapshots) &&
        input.parent_snapshots.length === 3,
      "THREE_PARENT_SNAPSHOTS_REQUIRED",
    );
    input.parent_snapshots.forEach((p) =>
      assert(
        p.id === input.parent_id &&
          p.type === "variable" &&
          p.status === "draft" &&
          p.variations?.includes(input.before.id),
        "VARIANT_PARENT_CHANGED",
      ),
    );
  }
  const identities = snapshots.map((s) => identity(s, input.kind));
  const identityChanged = identities.some(
    (i) => hash(i) !== hash(identities[0]),
  );
  const fields = input.fields.map((field) => {
    const [before, applied, current] = snapshots.map((s) => s[field]);
    const state =
      before === applied
        ? "NOT_CHANGED_BY_THIS_OPERATION"
        : current === before
          ? "ALREADY_RESTORED"
          : current === applied
            ? "REVIEWABLE_REVERSAL"
            : "LATER_EDIT_CONFLICT";
    return { field, before, applied, current, state };
  });
  const blocked =
    identityChanged || fields.some((f) => f.state === "LATER_EDIT_CONFLICT");
  return {
    version: "m9-rollback-review-1",
    mode: "OFFLINE_READ_ONLY",
    production_allowed: false,
    automatic_rollback_allowed: false,
    atomic_concurrency_control: false,
    current_snapshot_requires_refresh_before_any_future_write: true,
    input_sha256: hash(input),
    snapshot_hashes: snapshots.map(hash),
    resource_id: input.before.id,
    parent_id: input.kind === "variant" ? input.parent_id : null,
    identity_changed: identityChanged,
    state: blocked ? "MANUAL_REVIEW" : "REVIEW_ONLY",
    fields,
    // Even nonconflicting fields are not offered when any field or identity conflicts.
    reviewable_fields: blocked
      ? []
      : fields
          .filter((f) => f.state === "REVIEWABLE_REVERSAL")
          .map((f) => f.field),
    excluded: [
      "inventory",
      "orders",
      "promotions",
      "publication",
      "unselected_fields",
    ],
    limitation:
      "Supplied snapshots are evidence, not authenticated live state. GET/PUT atomicity and production recovery are not implemented.",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  assert(process.argv.length === 4, "USAGE_INPUT_JSON_NEW_REPORT_JSON");
  const report = inspectRollback(
    JSON.parse(await readFile(resolve(process.argv[2]), "utf8")),
  );
  await writeFile(
    resolve(process.argv[3]),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      state: report.state,
      reviewable_fields: report.reviewable_fields,
      automatic_rollback_allowed: false,
    }),
  );
}
