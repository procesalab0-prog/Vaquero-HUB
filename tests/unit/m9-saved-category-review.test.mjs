import { it, expect } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareSavedCategoryReview } from "../../scripts/m9/prepare-saved-category-review.mjs";
const fixture = () => {
  const product_id = "00000000-0000-4000-8000-000000000001";
  const mappings = [{ id: 1, path: "Dama's" }];
  return [
    {
      version: "m9-catalog-category-review-1",
      sources: { snapshot_sha256: "a".repeat(64) },
      items: [
        {
          product_id,
          woo_product_id: 10,
          state: "UNIQUE_PATH_PROPOSAL",
          mappings,
          source_categories: "Dama's",
        },
      ],
    },
    {
      version: "m9-catalog-public-taxonomy-1",
      mode: "PUBLIC_GET_ONLY",
      pagination_complete: true,
      captured_at: "2026-10-06T12:00:00Z",
      catalog_snapshot_sha256: "a".repeat(64),
      requested_ids: [10],
      categories: [{ id: 1, name: "Dama's", parent: 0 }],
      products: [{ id: 10, categories: [{ id: 1 }] }],
      not_returned_ids: [],
    },
    {
      project_id: "zsezjtswqeijboezvado",
      mode: "READ_ONLY",
      rows: [
        {
          product_id,
          woo_product_id: 10,
          source_categories: "Dama's",
          source_sha256: "b".repeat(64),
          source_fingerprint: "c".repeat(32),
          catalog_fingerprint: "d".repeat(32),
          draft_revision: 7,
          draft_fingerprint: "e".repeat(32),
          draft_categories: ["Dama's"],
          suggested_categories: ["Dama's"],
          binding_state: null,
        },
      ],
    },
    "f".repeat(64),
  ];
};
it("verifies CLI hashes, reproduces exact SQL, and refuses tampered inputs or an existing output", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "m9-saved-category-cli-"));
  try {
    const [proposal, capture, snapshot] = fixture();
    for (const [dir, name, value] of [
      ["proposal", "revision.json", proposal],
      ["capture", "taxonomy.json", capture],
    ]) {
      const p = join(root, dir),
        raw = JSON.stringify(value);
      await fs.mkdir(p);
      await fs.writeFile(join(p, name), raw);
      await fs.writeFile(
        join(p, "sha256.json"),
        JSON.stringify({
          [name]: createHash("sha256").update(raw).digest("hex"),
        }),
      );
    }
    await fs.writeFile(join(root, "snapshot.json"), JSON.stringify(snapshot));
    const script = fileURLToPath(
      new URL(
        "../../scripts/m9/prepare-saved-category-review.mjs",
        import.meta.url,
      ),
    );
    const run = (out) =>
      spawnSync(
        process.execPath,
        [
          script,
          join(root, "proposal"),
          join(root, "capture"),
          join(root, "snapshot.json"),
          join(root, out),
        ],
        { encoding: "utf8" },
      );
    expect(run("one").status).toBe(0);
    expect(run("two").status).toBe(0);
    for (const file of await fs.readdir(join(root, "one")))
      expect(await fs.readFile(join(root, "one", file), "utf8")).toBe(
        await fs.readFile(join(root, "two", file), "utf8"),
      );
    expect(run("one").status).not.toBe(0);
    await fs.appendFile(join(root, "capture", "taxonomy.json"), " ");
    expect(run("tampered").stderr).toContain("INPUT_HASH_CHANGED");
    await expect(fs.access(join(root, "tampered"))).rejects.toThrow();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("prepares deterministic guarded SQL without modifying drafts or authorizing dispatch", () => {
  const args = fixture(),
    before = JSON.stringify(args),
    r = prepareSavedCategoryReview(...args);
  expect(r.summary).toMatchObject({
    technical_reviews: 1,
    authorized_for_dispatch: 0,
  });
  expect(r.batches[0]).toContain("app.verify_saved_draft_categories");
  expect(r.batches[0]).toContain("Dama''s");
  expect(r.batches[0]).toContain('"draft_revision":7');
  expect(r.batches[0]).not.toMatch(/\b(update|delete|insert|fetch)\b/i);
  expect(JSON.stringify(args)).toBe(before);
  expect(prepareSavedCategoryReview(...args)).toEqual(r);
});
it("preserves valid existing bindings and holds invalidated or different mappings", () => {
  const a = fixture(),
    row = a[2].rows[0];
  row.binding_state = { valid: true, mappings: a[0].items[0].mappings };
  expect(prepareSavedCategoryReview(...a).summary.preserved_existing).toBe(1);
  row.binding_state.valid = false;
  expect(prepareSavedCategoryReview(...a).cases[0].issues).toContain(
    "EXISTING_BINDING_REVIEW_REQUIRED",
  );
  row.binding_state = { valid: true, mappings: [{ id: 2, path: "Other" }] };
  expect(prepareSavedCategoryReview(...a).batches).toEqual([]);
});
it("preserves identical IDs and paths regardless of order without rewriting the existing binding", () => {
  const a = fixture(),
    mappings = [
      { id: 1, path: "Dama's" },
      { id: 2, path: "B" },
    ];
  a[0].items[0].mappings = mappings;
  a[0].items[0].source_categories = "Dama's, B";
  a[1].categories.push({ id: 2, name: "B", parent: 0 });
  a[1].products[0].categories.push({ id: 2 });
  Object.assign(a[2].rows[0], {
    source_categories: "Dama's, B",
    draft_categories: ["Dama's, B"],
    suggested_categories: ["Dama's, B"],
    binding_state: { valid: true, mappings: [...mappings].reverse() },
  });
  const before = JSON.stringify(a),
    r = prepareSavedCategoryReview(...a);
  expect(r.summary.preserved_existing).toBe(1);
  expect(r.batches).toEqual([]);
  expect(JSON.stringify(a)).toBe(before);
});
it("holds edited categories, invalid fingerprints, and changed source CSV", () => {
  for (const [key, value, reason] of [
    ["draft_categories", ["Edited"], "HUMAN_CATEGORIES_REVIEW_REQUIRED"],
    ["draft_revision", 0, "INVALID_DESTINATION_FINGERPRINT"],
    ["draft_fingerprint", null, "INVALID_DESTINATION_FINGERPRINT"],
    ["source_categories", "Different", "SOURCE_CHANGED"],
  ]) {
    const a = fixture();
    a[2].rows[0][key] = value;
    const r = prepareSavedCategoryReview(...a);
    expect(r.cases[0].issues).toContain(reason);
    expect(r.batches).toEqual([]);
  }
});
it("recomputes public membership and reserves absent sources without deleting", () => {
  const a = fixture();
  a[1].products = [];
  a[1].not_returned_ids = [10];
  expect(prepareSavedCategoryReview(...a).cases[0].issues).toContain(
    "NOT_RETURNED_PUBLICLY_NO_DELETE",
  );
  const b = fixture();
  b[2].rows = [];
  expect(prepareSavedCategoryReview(...b).cases[0].issues).toContain(
    "WEB_SOURCE_ABSENT",
  );
});
it("rejects wrong destination, duplicate sources, unexpected scope and injected hashes", () => {
  const a = fixture();
  a[2].project_id = "production";
  expect(() => prepareSavedCategoryReview(...a)).toThrow(
    "INVALID_STAGING_REVIEW_INPUT",
  );
  const b = fixture();
  b[2].rows.push({ ...b[2].rows[0] });
  expect(() => prepareSavedCategoryReview(...b)).toThrow(
    "DUPLICATE_OR_INVALID_STAGING_SOURCE",
  );
  const c = fixture();
  c[2].rows[0].woo_product_id = 99;
  expect(() => prepareSavedCategoryReview(...c)).toThrow(
    "UNEXPECTED_STAGING_SOURCE",
  );
  const d = fixture();
  d[3] = "'; select 1;--";
  expect(() => prepareSavedCategoryReview(...d)).toThrow(
    "INVALID_STAGING_REVIEW_INPUT",
  );
});
