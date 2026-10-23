import { describe, expect, it } from "vitest";
import { comparePublicWoo } from "../../scripts/m9/compare-public-woo.mjs";
const old = () => ({
  schema_version: 1,
  scope: "authenticated_csv_excludes_trash",
  pagination_complete: true,
  expected_parents_from_panel: 2,
  source_csv_sha256: "a".repeat(64),
  products: [
    {
      id: 1,
      type: "simple",
      status: "publish",
      name: "Uno",
      images: "https://example.org/a.jpg",
    },
    { id: 2, type: "variable", status: "draft", images: "" },
  ],
});
const current = () => ({
  schema_version: 1,
  source: "https://vaquerosm.com",
  scope: "published_public",
  pagination_complete: true,
  captured_at: "2026-10-23T02:04:20.045Z",
  products: [
    {
      id: 1,
      type: "simple",
      name: "<p>Uno</p>",
      images: [{ src: "https://cdn.example.org/a.jpg" }],
    },
  ],
});
describe("public Woo complement never replaces authenticated evidence", () => {
  it("keeps an absent draft UNKNOWN, never deleted or linked", () => {
    const result = comparePublicWoo(old(), current());
    expect(result.unobserved).toEqual([
      {
        id: 2,
        historical_status: "draft",
        current_status: "UNOBSERVED",
        deletion_confirmed: false,
      },
    ]);
    expect(result.automatic_writes).toEqual([]);
    expect(result.variations_observed).toBe(false);
    expect(result.prices_compared).toBe(false);
  });
  it("reports literal representations without asserting changed photographs or semantic text", () => {
    const result = comparePublicWoo(old(), current());
    expect(result.rows[0].image_literal_urls_differ).toBe(true);
    expect(result.rows[0].raw_text_or_identity_differences).toEqual(["name"]);
    expect(result.categories_comparable).toBe(false);
  });
  it("rejects partial/public sources substituted for the full snapshot", () => {
    expect(() =>
      comparePublicWoo({ ...old(), scope: "published_public" }, current()),
    ).toThrow();
    expect(() =>
      comparePublicWoo(old(), { ...current(), pagination_complete: false }),
    ).toThrow();
  });
  it("rejects duplicate IDs and incomplete provenance", () => {
    const p = current();
    expect(() =>
      comparePublicWoo(old(), {
        ...p,
        products: [...p.products, ...p.products],
      }),
    ).toThrow();
    expect(() =>
      comparePublicWoo({ ...old(), source_csv_sha256: "" }, p),
    ).toThrow();
  });
  it("counts newly visible historical drafts without rewriting their old status", () => {
    const before = old();
    before.products[0].status = "draft";
    const result = comparePublicWoo(before, current());
    expect(result.summary.formerly_unpublished_observed_publicly).toBe(1);
    expect(before.products[0].status).toBe("draft");
    expect(result.rows[0].historical_status).toBe("draft");
  });
});
