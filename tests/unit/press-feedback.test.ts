import { describe, expect, it } from "vitest";

import { inkColor } from "../../lib/press-feedback";

describe("huella al tocar", () => {
  it("es clara sobre botones oscuros", () => {
    expect(inkColor("rgb(91, 64, 33)")).toBe("rgb(255 255 255 / 38%)");
    expect(inkColor("rgb(0, 0, 0)")).toBe("rgb(255 255 255 / 38%)");
  });

  it("es café sobre botones claros o transparentes", () => {
    expect(inkColor("rgb(255, 253, 250)")).toBe("rgb(91 64 33 / 20%)");
    expect(inkColor("rgba(0, 0, 0, 0)")).toBe("rgb(91 64 33 / 20%)");
    expect(inkColor("transparent")).toBe("rgb(91 64 33 / 20%)");
  });

  it("entiende la sintaxis nueva de color", () => {
    expect(inkColor("rgb(36 30 27 / 0.95)")).toBe("rgb(255 255 255 / 38%)");
  });
});
