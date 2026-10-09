import { describe, it, expect } from "vitest";
import { prepareSourceGalleryCopy } from "../../scripts/m9/source-gallery-copy.mjs";
const a = "https://vaquerosm.com/wp-content/uploads/a.jpg";
const b = "https://vaquerosm.com/wp-content/uploads/b.jpg";
function fixture() {
  return {
    productId: "p",
    source: {
      product_id: "p",
      woo_product_id: 42,
      images: [{ url: a }, { url: b }],
    },
    current: {
      images: [
        { url: b, alt: "Portada editada" },
        { url: a, alt: "Otra" },
      ],
    },
    readPhoto: async (url) => ({
      sha256: url === a ? "a".repeat(64) : "b".repeat(64),
      base64: "aW1hZ2U=",
    }),
  };
}
describe("source gallery migration", () => {
  it("preserves current editorial order and alt", async () => {
    const p = await prepareSourceGalleryCopy(fixture());
    expect(p.photos.map((i) => i.alt)).toEqual(["Portada editada", "Otra"]);
    expect(p.photos[0].sha256).toBe("b".repeat(64));
  });
  it("rejects another product binding", async () => {
    const f = fixture();
    f.source.product_id = "other";
    await expect(prepareSourceGalleryCopy(f)).rejects.toThrow("IDENTITY");
  });
  it("rejects a foreign photograph not in the matched source", async () => {
    const f = fixture();
    f.current.images[0].url =
      "https://vaquerosm.com/wp-content/uploads/other.jpg";
    await expect(prepareSourceGalleryCopy(f)).rejects.toThrow("CHANGED");
  });
  it("rejects duplicate photo bytes", async () => {
    const f = fixture();
    f.readPhoto = async () => ({ sha256: "a".repeat(64), base64: "aW1hZ2U=" });
    await expect(prepareSourceGalleryCopy(f)).rejects.toThrow("DUPLICATE");
  });
  it("recognizes already stored galleries without network", async () => {
    const f = fixture();
    f.current.images = [
      {
        url: "https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/p/hash.jpg",
        alt: "",
      },
    ];
    f.readPhoto = async () => {
      throw new Error("unexpected read");
    };
    expect((await prepareSourceGalleryCopy(f)).unchanged).toBe(true);
  });
});
