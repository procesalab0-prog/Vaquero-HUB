import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { prepareSicarPublicPrices } from "../../scripts/m9/catalogo-precio-publico-plan.mjs";
import {
  TWELVE_CODES,
  TWELVE_PROTOCOL,
  PRICE_PREIMAGES,
  patchTwelvePriceDefinitions,
} from "../../scripts/m9/catalogo-precio-publico-twelve.mjs";
import { renderTwelvePriceForward } from "../../scripts/m9/catalogo-precio-publico-twelve-sql.mjs";
const fixture = () => ({
  protocol: TWELVE_PROTOCOL,
  before: [],
  after: [],
  context: { observed_at: "2026-10-24 06:23:46.333265+00", expected_state: [] },
  source_before_sha256:
    "33b1d36200f8db0eecf0cd1fbdd1c76400ee291d747348a6c87881f39043cc44",
  source_after_sha256:
    "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93",
  request_id: "11111111-1111-4111-8111-111111111111",
  asOf: "2026-10-24T06:23:46.334Z",
});
describe("twelve fixed public prices: preparation boundaries, not SQL acceptance", () => {
  it("never expands the code set or groups the independent products", () =>
    expect(TWELVE_CODES).toEqual([
      "3416",
      "3417",
      "3418",
      "3419",
      "3420",
      "3421",
      "3422",
      "3423",
      "3424",
      "3425",
      "3426",
      "3427",
    ]));
  it.each([null, "", 0, "1".repeat(64)])(
    "rejects unverified source cut %s",
    (value) => {
      const f = fixture();
      f.source_after_sha256 = value;
      expect(() => prepareSicarPublicPrices(f)).toThrow(/ORIGINAL_CUTS/);
    },
  );
  it.each([
    null,
    "now",
    "2026-02-30T06:23:46.334Z",
    "10/24/2026",
    "2026-10-24T06:23:46Z",
    "2026-10-24T06:23:46.333+00:00",
  ])("rejects ambiguous/noncanonical reviewed date %s", (asOf) =>
    expect(() => prepareSicarPublicPrices({ ...fixture(), asOf })).toThrow(
      /CANONICAL_DATE|STALE_CONTEXT/,
    ),
  );
  it.each(["2026-10-24T06:23:46.332Z", "2026-10-24T06:38:46.334Z"])(
    "rejects stale/future relative context %s",
    (asOf) =>
      expect(() => prepareSicarPublicPrices({ ...fixture(), asOf })).toThrow(
        /STALE_CONTEXT/,
      ),
  );
  it.each([null, "now", "2026-02-30 06:23:46.333265+00"])(
    "rejects ambiguous observed_at %s",
    (observed_at) => {
      const f = fixture();
      f.context.observed_at = observed_at;
      expect(() => prepareSicarPublicPrices(f)).toThrow(/CANONICAL_DATE/);
    },
  );
  it.each([null, "uuid", "11111111-1111-4111-8111-111111111111 "])(
    "requires literal request UUID %s",
    (request_id) =>
      expect(() =>
        prepareSicarPublicPrices({ ...fixture(), request_id }),
      ).toThrow(/REQUEST_UUID/),
  );
  it("requires each literal row instead of inferring missing or duplicated codes", () =>
    expect(() => prepareSicarPublicPrices(fixture())).toThrow(
      /UNIQUE_LITERAL_ROWS/,
    ));
  it("does not silently accept an unknown dispatch protocol", () =>
    expect(() =>
      prepareSicarPublicPrices({
        ...fixture(),
        protocol: TWELVE_PROTOCOL + "-extra",
      }),
    ).toThrow(/UNSUPPORTED_PRICE_PROTOCOL/));
  it("retains the six exact installed definition preimages", () => {
    expect(Object.keys(PRICE_PREIMAGES)).toHaveLength(6);
    expect(() => patchTwelvePriceDefinitions({})).toThrow(/INSTALLED_PREIMAGE/);
    const fake = Object.fromEntries(
      Object.keys(PRICE_PREIMAGES).map((k) => [k, "CREATE FUNCTION forged()"]),
    );
    expect(() => patchTwelvePriceDefinitions(fake)).toThrow(
      /INSTALLED_PREIMAGE/,
    );
  });
  it("keeps generated SQL byte-identical with the reviewed candidate file", async () =>
    expect(
      await readFile(
        new URL(
          "../../scripts/m9/catalogo-precio-publico-twelve-forward.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toBe(renderTwelvePriceForward()));
  it("generates no alternative ledger, stock/cost writes or public grant", () => {
    const sql = renderTwelvePriceForward();
    expect(sql).not.toMatch(
      /create\s+table|grant\s+execute|update\s+public\.inventory|set\s+cost_cents/i,
    );
    expect(sql).toContain("Same APPLY/REVERSE/journal");
    expect(sql).toContain("CANDIDATE ONLY");
    expect(sql).toContain(
      "SICAR_TWELVE_PRICE_INSTALLED_PREIMAGE_OR_ACL_CHANGED",
    );
  });
});
