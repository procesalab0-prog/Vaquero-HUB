import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compareCatalogCategories } from "../../scripts/m9/compare-catalog-categories.mjs";
const fixture = () => ({
  proposal: {
    version: "m9-catalog-category-review-1",
    sources: { snapshot_sha256: "a".repeat(64) },
    items: [
      {
        product_id: "internal",
        woo_product_id: 10,
        name: "Product",
        source_categories: "Dama, Dama > Camisa",
        state: "UNIQUE_PATH_PROPOSAL",
        mappings: [
          { id: 1, path: "Dama" },
          { id: 2, path: "Dama > Camisa" },
        ],
      },
    ],
  },
  capture: {
    version: "m9-catalog-public-taxonomy-1",
    mode: "PUBLIC_GET_ONLY",
    pagination_complete: true,
    captured_at: "2026-10-06T12:00:00Z",
    catalog_snapshot_sha256: "a".repeat(64),
    requested_ids: [10],
    categories: [
      { id: 1, name: "Dama", parent: 0 },
      { id: 2, name: "Camisa", parent: 1 },
    ],
    products: [{ id: 10, categories: [{ id: 2 }, { id: 1 }] }],
    not_returned_ids: [],
  },
});
describe("category membership comparison", () => {
  it("replays verified CLI inputs byte-identically and rejects tampered input before creating output", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "m9-category-cli-test-"));
    try {
      const { proposal, capture } = fixture();
      for (const [dir, name, value] of [
        ["proposal", "revision.json", proposal],
        ["capture", "taxonomy.json", capture],
      ]) {
        const base = join(root, dir);
        await fs.mkdir(base);
        const raw = JSON.stringify(value);
        await fs.writeFile(join(base, name), raw);
        await fs.writeFile(
          join(base, "sha256.json"),
          JSON.stringify({
            [name]: createHash("sha256").update(raw).digest("hex"),
          }),
        );
      }
      const script = fileURLToPath(
        new URL(
          "../../scripts/m9/compare-catalog-categories.mjs",
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
            join(root, out),
          ],
          { encoding: "utf8" },
        );
      expect(run("one").status).toBe(0);
      expect(run("two").status).toBe(0);
      for (const name of [
        "comparacion.json",
        "resumen.json",
        "candidatos-revision-binding.json",
        "sha256.json",
      ]) {
        expect(await fs.readFile(join(root, "one", name), "utf8")).toBe(
          await fs.readFile(join(root, "two", name), "utf8"),
        );
      }
      await fs.appendFile(join(root, "capture", "taxonomy.json"), " ");
      const rejected = run("tampered");
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("INPUT_HASH_CHANGED");
      await expect(fs.access(join(root, "tampered"))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it("matches reordered IDs but still requires protected destination review before writes", () => {
    const { proposal, capture } = fixture(),
      result = compareCatalogCategories(proposal, capture);
    expect(result.summary).toMatchObject({
      matches_at_capture: 1,
      approved_for_send: 0,
      database_writes: 0,
    });
    expect(result.binding_review_candidates[0]).toMatchObject({
      human_draft_protection_required: true,
      destination_fingerprint_required: true,
      write_allowed: false,
    });
    expect(result.items[0].send_allowed).toBe(false);
  });
  it("holds changed membership without replacing the old proposal", () => {
    const { proposal, capture } = fixture();
    capture.products[0].categories = [{ id: 1 }];
    const before = structuredClone(proposal),
      result = compareCatalogCategories(proposal, capture);
    expect(result.items[0].reasons).toContain("PUBLIC_MEMBERSHIP_DIFFERS");
    expect(result.binding_review_candidates).toEqual([]);
    expect(proposal).toEqual(before);
  });
  it("does not silently reuse category names when their IDs change", () => {
    const { proposal, capture } = fixture();
    capture.categories[1].id = 3;
    capture.products[0].categories = [{ id: 1 }, { id: 3 }];
    expect(
      compareCatalogCategories(proposal, capture).items[0].reasons,
    ).toContain("CATEGORY_ID_MAPPING_CHANGED");
  });
  it("preserves omitted public products for review without assuming deletion", () => {
    const { proposal, capture } = fixture();
    capture.products = [];
    capture.not_returned_ids = [10];
    const r = compareCatalogCategories(proposal, capture);
    expect(r.items[0].reasons).toContain("NOT_RETURNED_PUBLICLY_NO_DELETE");
    expect(r.summary.not_returned_publicly).toBe(1);
    capture.not_returned_ids = [];
    expect(() => compareCatalogCategories(proposal, capture)).toThrow(
      "CAPTURE_PARTITION_MISMATCH",
    );
  });
  it("rejects mismatched snapshots, unexpected IDs, duplicate products and missing request coverage", () => {
    const { proposal, capture } = fixture();
    expect(() =>
      compareCatalogCategories(proposal, {
        ...capture,
        catalog_snapshot_sha256: "b".repeat(64),
      }),
    ).toThrow("CAPTURE_PROVENANCE_REQUIRED");
    expect(() =>
      compareCatalogCategories(proposal, { ...capture, requested_ids: [] }),
    ).toThrow("REQUEST_SCOPE_MISMATCH");
    expect(() =>
      compareCatalogCategories(proposal, {
        ...capture,
        products: [{ id: 99, categories: [] }],
      }),
    ).toThrow("INVALID_CAPTURE_PRODUCT");
    expect(() =>
      compareCatalogCategories(proposal, {
        ...capture,
        products: [...capture.products, ...capture.products],
      }),
    ).toThrow("INVALID_CAPTURE_PRODUCT");
  });
  it("holds unknown or repeated public categories and never upgrades a manual proposal", () => {
    const { proposal, capture } = fixture();
    capture.products[0].categories = [{ id: 1 }, { id: 1 }, { id: 99 }];
    const reasons = compareCatalogCategories(proposal, capture).items[0]
      .reasons;
    expect(reasons).toContain("UNKNOWN_PUBLIC_CATEGORY_ID");
    expect(reasons).toContain("DUPLICATE_PUBLIC_CATEGORY_ID");
    const f = fixture();
    f.proposal.items[0].state = "MANUAL_REVIEW";
    expect(
      compareCatalogCategories(f.proposal, f.capture).items[0].reasons,
    ).toContain("ORIGINAL_PROPOSAL_REQUIRES_REVIEW");
  });
  it("treats path ambiguities as review even if a public membership fits one interpretation", () => {
    const { proposal, capture } = fixture();
    proposal.items[0].source_categories = "A, B";
    capture.categories = [
      { id: 1, name: "A", parent: 0 },
      { id: 2, name: "B", parent: 0 },
      { id: 3, name: "A, B", parent: 0 },
    ];
    expect(
      compareCatalogCategories(proposal, capture).items[0].reasons,
    ).toContain("CURRENT_PATHS_REQUIRE_REVIEW");
  });
});
