import { describe, it, expect } from "vitest";
import {
  draftFromPacket,
  editorialText,
  sourceSql,
} from "../../scripts/m9/prepare-web-drafts.mjs";
describe("fuente editorial reproducible", () => {
  it("conserva evidencia original y propone fotos únicas ordenadas", () => {
    const p = {
      name: "Bota",
      short_description_html: "<p>000BASE</p>",
      description_html: "<p>Uno</p><p>Dos &amp; tres</p>",
      image_urls: [
        "https://vaquerosm.com/wp-content/uploads/a.jpg",
        "https://vaquerosm.com/wp-content/uploads/a.jpg",
      ],
      categories_source: "Botas",
    };
    const c = draftFromPacket(p);
    expect(c.base_code).toBe("000BASE");
    expect(c.images).toHaveLength(1);
    expect(p.image_urls).toHaveLength(2);
    expect(c.description).toBe("Uno\nDos & tres");
  });
  it("texto no ejecuta ni conserva scripts", () =>
    expect(
      editorialText("<script>alert(1)</script><p>Seguro &lt;texto&gt;</p>"),
    ).toBe("Seguro <texto>"));
  it("SQL sólo carga fuentes vinculadas y escapa texto", () => {
    const packet = {
      products: [
        {
          woo_product_id: 7,
          name: "O'Connor",
          short_description_html: "BASE",
          description_html: "texto",
          image_urls: [],
          categories_source: "",
        },
      ],
    };
    const sql = sourceSql(packet, "a".repeat(64));
    expect(sql).toContain("O''Connor");
    expect(sql).toContain("into strict pid");
    expect(sql).toContain("WEB_SOURCE_CHANGED_REVIEW_REQUIRED");
    expect(sql).not.toContain("insert into public.products");
    expect(sourceSql(packet, "a".repeat(64))).toBe(sql);
  });
});
