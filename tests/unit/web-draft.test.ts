import { describe, it, expect } from "vitest";
import {
  validWebImage,
  webContentFromForm,
  webDraftIssues,
} from "../../lib/web-draft";
function form() {
  const f = new FormData();
  f.set("web_name", "Bota");
  f.set("web_base_code", "000BASE");
  f.set(
    "web_images",
    "https://vaquerosm.com/wp-content/uploads/a.jpg | Frente",
  );
  return f;
}
describe("ficha web sin envío", () => {
  it("conserva código base como texto y orden/alt de la galería", () => {
    const c = webContentFromForm(form());
    expect(c.base_code).toBe("000BASE");
    expect(c.images).toEqual([
      { url: "https://vaquerosm.com/wp-content/uploads/a.jpg", alt: "Frente" },
    ]);
    expect(c).not.toHaveProperty("barcode");
    expect(c).not.toHaveProperty("stock");
  });
  it.each([
    "http://vaquerosm.com/wp-content/uploads/a.jpg",
    "https://vaquerosm.com.evil.test/wp-content/uploads/a.jpg",
    "https://user@vaquerosm.com/wp-content/uploads/a.jpg",
    "https://127.0.0.1/a.jpg",
    "javascript:alert(1)",
    "https://vaquerosm.com/wp-admin/x",
  ])("rechaza imagen %s", (url) => expect(validWebImage(url)).toBe(false));
  it("rechaza fotos duplicadas y cantidades excesivas", () => {
    const f = form();
    f.set("web_images", [f.get("web_images"), f.get("web_images")].join("\n"));
    expect(() => webContentFromForm(f)).toThrow();
    f.set(
      "web_images",
      Array.from(
        { length: 21 },
        (_, i) => `https://vaquerosm.com/wp-content/uploads/${i}.jpg`,
      ).join("\n"),
    );
    expect(() => webContentFromForm(f)).toThrow();
  });
  it("una ficha completa sigue requiriendo mapa de categorías y conservar familia", () => {
    const c = webContentFromForm(form());
    c.description = "Texto";
    c.short_description = "BASE";
    c.categories = ["Botas"];
    const issues = webDraftIssues(c, true);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain("correspondencia");
    expect(issues[1]).toContain("fuera del piloto");
  });
});
