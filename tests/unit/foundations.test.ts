import { describe, expect, it } from "vitest";

describe("fundaciones de Vaquero HUB", () => {
  it("mantiene los importes monetarios como enteros", () => {
    const totalCents = 1_299 + 2_501;

    expect(totalCents).toBe(3_800);
    expect(Number.isInteger(totalCents)).toBe(true);
  });
});
