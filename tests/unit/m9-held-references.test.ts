import { describe, it, expect } from "vitest";
import {
  heldReferenceQuery,
  heldReferenceHref,
  isHeldReferenceView,
  type HeldReferenceView,
} from "../../lib/m9-held-references";
function view(): HeldReferenceView {
  return {
    protocol: "m9-held-reference-read-1",
    ready: true,
    write_allowed: false,
    operational_authorization: false,
    source_date: "2026-10-22",
    source_sha256: "a".repeat(64),
    archived_at: "2026-10-23T01:55:00Z",
    total_references: 435,
    reason_counts: {
      DISPLAY_OR_SALES_RESTRICTION: 316,
      TAXONOMY_REVIEW: 86,
      PUBLIC_PRICE_INVALID: 40,
      CATEGORY_CONFLICT: 3,
    },
    total: 1,
    page: 1,
    page_size: 20,
    current_catalog_overlap: 0,
    origin_changed: 0,
    price_subgroups: { extra_decimals: 38, zero: 2 },
    examples: {
      DISPLAY_OR_SALES_RESTRICTION: [],
      TAXONOMY_REVIEW: [],
      PUBLIC_PRICE_INVALID: [],
      CATEGORY_CONFLICT: [],
    },
    rows: [
      {
        barcode: "000007779",
        reasons: ["PUBLIC_PRICE_INVALID"],
        display_restricted: false,
        origin_cut_sha: "b".repeat(64),
        origin_intact: true,
        projection: {
          description: "Literal <script>",
          department: "UNISEX",
          section: "TEXANAS",
          retail_source: "6299.99944",
        },
        catalog_now_present: false,
        sell_allowed: false,
        stock_allowed: false,
        woo_allowed: false,
      },
    ],
  };
}
describe("held reference reader boundary", () => {
  it("preserves exact code including leading zeros and whitespace", () => {
    const q = heldReferenceQuery({
      q: " 000007779",
      mode: "exact",
      reason: "PUBLIC_PRICE_INVALID",
      page: "2",
    });
    expect(q.q).toBe(" 000007779");
    expect(q.exact).toBe(true);
    expect(
      new URL("https://example.test" + heldReferenceHref(q)).searchParams.get(
        "q",
      ),
    ).toBe(q.q);
  });
  it.each([
    { q: ["0001"] },
    { q: "x".repeat(161) },
    { mode: "substring" },
    { reason: "PRICE" },
    { page: "0" },
    { page: "1.2" },
    { page: "100000" },
  ])("rejects malformed filters %j", (p) => {
    expect(() => heldReferenceQuery(p)).toThrow("FILTER_INVALID");
  });
  it("accepts empty unready state without implying permission", () => {
    expect(
      isHeldReferenceView({
        protocol: "m9-held-reference-read-1",
        ready: false,
        write_allowed: false,
        operational_authorization: false,
      }),
    ).toBe(true);
  });
  it("retains the full literal decimal and overlapping reason counts", () => {
    const v = view();
    expect(isHeldReferenceView(v)).toBe(true);
    expect(v.rows[0].projection?.retail_source).toBe("6299.99944");
    expect(Object.values(v.reason_counts).reduce((a, b) => a + b, 0)).toBe(445);
    expect(v.total_references).toBe(435);
  });
  it.each([
    (v: HeldReferenceView) => {
      v.write_allowed = true as false;
    },
    (v: HeldReferenceView) => {
      v.operational_authorization = true as false;
    },
    (v: HeldReferenceView) => {
      v.rows[0].sell_allowed = true as false;
    },
    (v: HeldReferenceView) => {
      v.rows[0].woo_allowed = true as false;
    },
    (v: HeldReferenceView) => {
      v.rows[0].stock_allowed = true as false;
    },
    (v: HeldReferenceView) => {
      v.rows[0].display_restricted = true;
    },
    (v: HeldReferenceView) => {
      v.rows.push(structuredClone(v.rows[0]));
    },
    (v: HeldReferenceView) => {
      v.rows[0].reasons = ["UNKNOWN" as "PUBLIC_PRICE_INVALID"];
    },
    (v: HeldReferenceView) => {
      v.price_subgroups.zero = 40;
    },
    (v: HeldReferenceView) => {
      v.total_references = 445;
    },
    (v: HeldReferenceView) => {
      v.rows[0].origin_intact = false;
    },
    (v: HeldReferenceView) => {
      v.rows[0].projection = {
        description: "x",
        department: "x",
        section: "x",
        other: "x",
      } as unknown as HeldReferenceView["rows"][0]["projection"];
    },
  ])("rejects widened authorization or inconsistent projection", (change) => {
    const v = view();
    change(v);
    expect(isHeldReferenceView(v)).toBe(false);
  });
  it("accepts a held changed-origin row only without its projection", () => {
    const v = view();
    v.rows[0].origin_intact = false;
    v.rows[0].projection = null;
    v.origin_changed = 1;
    expect(isHeldReferenceView(v)).toBe(true);
  });
});
