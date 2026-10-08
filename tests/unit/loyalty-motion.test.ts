import { describe, expect, it } from "vitest";

import { recentEarn } from "../../lib/loyalty-motion";

const now = new Date("2026-10-07T18:00:00Z");
const earn = (hoursAgo: number, points = 120) => ({
  id: "m1",
  type: "EARN",
  points,
  created_at: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
});

describe("celebración de puntos en Mi Vaquero", () => {
  it("cuenta desde el saldo anterior hasta el actual", () => {
    expect(recentEarn([earn(2)], 450, now)).toEqual({
      id: "m1",
      points: 120,
      from: 330,
      to: 450,
    });
  });

  it("sólo celebra compras recientes", () => {
    expect(recentEarn([earn(47)], 450, now)).not.toBeNull();
    expect(recentEarn([earn(49)], 450, now)).toBeNull();
  });

  it("no celebra canjes, vencimientos ni ajustes", () => {
    for (const type of ["REDEEM", "EXPIRE", "RETURN_REVERSAL", "ADJUSTMENT"])
      expect(recentEarn([{ ...earn(1), type }], 450, now)).toBeNull();
    expect(recentEarn([], 450, now)).toBeNull();
  });

  it("no inventa un saldo negativo al contar", () => {
    expect(recentEarn([earn(1, 500)], 200, now)?.from).toBe(0);
  });
});
