import { describe, it, expect } from "vitest";
import {
  draftQuantity,
  physicalComparison,
  legacyPilotFailure,
} from "../../lib/legacy-pilot";
describe("legacy pilot draft keeps evidence separate from operational stock", () => {
  it("preserves missing as null and requires an explicit zero", () => {
    expect(draftQuantity("")).toBeNull();
    expect(draftQuantity("0")).toBe(0);
    expect(physicalComparison(null, null, null)).toEqual({
      complete: false,
      available: null,
      import_allowed: false,
      count_certified: false,
    });
  });
  it("rejects negative, fractional, exponent, normalized or oversized quantities", () => {
    for (const v of ["-1", "1.5", "1e2", "01", " 1", "1 ", "1000000", "NaN"])
      expect(() => draftQuantity(v)).toThrow(
        "M9_EXPLICIT_WHOLE_QUANTITY_REQUIRED",
      );
  });
  it("does not infer zero commitments when only physical was counted", () => {
    expect(physicalComparison(4, null, null).available).toBeNull();
    expect(physicalComparison(0, 0, null).complete).toBe(false);
  });
  it("compares only complete counts, without authorizing import or certification", () => {
    expect(physicalComparison(4, 1, 1)).toEqual({
      complete: true,
      available: 2,
      import_allowed: false,
      count_certified: false,
    });
    expect(physicalComparison(0, 0, 0).available).toBe(0);
  });
  it("rejects already-sold and separated quantities exceeding physical presence", () => {
    expect(() => physicalComparison(2, 2, 1)).toThrow(
      "M9_COMMITMENTS_EXCEED_PHYSICAL",
    );
    expect(() => physicalComparison(0, 1, null)).toThrow(
      "M9_COMMITMENTS_EXCEED_PHYSICAL",
    );
  });
  it("validates input even if the physical field remains pending", () => {
    for (const n of [-1, 0.1, NaN, 1000000])
      expect(() => physicalComparison(null, n, null)).toThrow();
  });
  it("maps concurrency and stale baseline errors without exposing database details", () => {
    expect(legacyPilotFailure("M9_DRAFT_REVISION_CHANGED")).toBe("revision");
    expect(legacyPilotFailure("M9_PILOT_BASELINE_CHANGED")).toBe(
      "base-cambiada",
    );
    expect(legacyPilotFailure("IDEMPOTENCY_CONFLICT")).toBe("conflicto");
    expect(legacyPilotFailure("customer private data")).toBe("error");
  });
});
