import { describe, expect, it } from "vitest";

import { ACCENT_COLORS, accentTokens } from "../../lib/accent";

describe("acento de la interfaz", () => {
  it("cambia el acento y también los tonos derivados", () => {
    const tokens = accentTokens("vino");
    expect(tokens).not.toBeNull();
    expect(tokens!["--accent"]).toBe(ACCENT_COLORS.vino);
    // El botón se oscurece al tocarlo: si estos no siguen al acento, el botón
    // cambia de color bajo el dedo.
    expect(tokens!["--accent-hover"]).not.toBe(tokens!["--accent"]);
    expect(tokens!["--accent-pressed"]).not.toBe(tokens!["--accent-hover"]);
    expect(tokens!["--accent-soft"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("oscurece hacia el negro y aclara hacia el blanco", () => {
    const luminancia = (hex: string) =>
      [1, 3, 5].reduce(
        (total, offset) =>
          total + Number.parseInt(hex.slice(offset, offset + 2), 16),
        0,
      );
    for (const name of Object.keys(ACCENT_COLORS)) {
      const tokens = accentTokens(name)!;
      expect(luminancia(tokens["--accent-hover"])).toBeLessThan(
        luminancia(tokens["--accent"]),
      );
      expect(luminancia(tokens["--accent-pressed"])).toBeLessThan(
        luminancia(tokens["--accent-hover"]),
      );
      expect(luminancia(tokens["--accent-soft"])).toBeGreaterThan(
        luminancia(tokens["--accent"]),
      );
    }
  });

  it("no inventa colores para un acento desconocido", () => {
    expect(accentTokens("turquesa")).toBeNull();
    expect(accentTokens("")).toBeNull();
  });
});
