import { describe, expect, it } from "vitest";

import { loginScene, storeDay } from "../../lib/entrance";

describe("escena de la pantalla de acceso", () => {
  it("usa la fecha de la tienda, no la del servidor", () => {
    // 03:00 UTC del 8 de octubre todavía es 7 de octubre en La Piedad.
    expect(storeDay(new Date("2026-10-08T03:00:00Z"))).toBe("2026-10-07");
    expect(storeDay(new Date("2026-10-08T07:00:00Z"))).toBe("2026-10-08");
  });

  it("muestra la escena completa una vez al día y la corta después", () => {
    const today = "2026-10-07";
    expect(loginScene({ hasError: false, lastFullDay: undefined, today })).toBe(
      "full",
    );
    expect(
      loginScene({ hasError: false, lastFullDay: "2026-10-06", today }),
    ).toBe("full");
    expect(loginScene({ hasError: false, lastFullDay: today, today })).toBe(
      "short",
    );
  });

  it("no anima nada cuando se vuelve por un error", () => {
    expect(
      loginScene({
        hasError: true,
        lastFullDay: undefined,
        today: "2026-10-07",
      }),
    ).toBe("none");
  });
});
