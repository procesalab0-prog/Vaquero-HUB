import { describe, it, expect } from "vitest";
import { prepareGalleryPull } from "../../scripts/m9/woo-remote/pull-gallery.mjs";
import { TEST_ORIGIN } from "../../scripts/m9/woo-remote/client.mjs";
const a = "a".repeat(64),
  b = "b".repeat(64);
function fixture() {
  return {
    packet: {
      product_id: "p",
      barcode: "0012",
      content: { images: [{ alt: "" }] },
    },
    receipt: {
      state: "SUCCEEDED",
      product_id: "p",
      remote_product_id: 18,
      verified: { barcode: "0012", image_sha256: a },
    },
    remote: {
      origin: TEST_ORIGIN,
      product_id: "p",
      woo_product_id: 18,
      barcode: "0012",
      complete: true,
      revision: "c".repeat(64),
      images: [
        {
          id: 19,
          url: TEST_ORIGIN + "/wp-content/uploads/a.jpg",
          sha256: a,
          alt: "",
        },
        {
          id: 20,
          url: TEST_ORIGIN + "/wp-content/uploads/b.jpg",
          sha256: b,
          alt: "Segunda",
        },
      ],
    },
    current: {
      images: [
        { url: "https://vaquerosm.com/wp-content/uploads/a.jpg", alt: "" },
      ],
    },
    readPhoto: async (url) => ({
      sha256: url.endsWith("b.jpg") ? b : a,
      base64: Buffer.from("image").toString("base64"),
    }),
  };
}
describe("remote photo adoption", () => {
  it("preserves gallery order and alt on an unchanged initial draft", async () => {
    const p = await prepareGalleryPull(fixture());
    expect(p.images.map((i) => i.sha256)).toEqual([a, b]);
    expect(p.images[1].alt).toBe("Segunda");
  });
  it("recognizes an exact repeat across different storage URLs", async () => {
    const f = fixture();
    f.current.images = [
      { url: "https://local/a.jpg", alt: "" },
      { url: "https://local/b.jpg", alt: "Segunda" },
    ];
    expect((await prepareGalleryPull(f)).unchanged).toBe(true);
  });
  it("blocks simultaneous local edits", async () => {
    const f = fixture();
    f.current.images[0].alt = "Cambio local";
    await expect(prepareGalleryPull(f)).rejects.toThrow("BOTH_CHANGED");
  });
  it("blocks removal of original cover", async () => {
    const f = fixture();
    f.remote.images.shift();
    await expect(prepareGalleryPull(f)).rejects.toThrow("REMOVAL");
  });
  it.each(["product_id", "barcode", "origin", "woo_product_id"])(
    "rejects identity mismatch %s",
    async (key) => {
      const f = fixture();
      f.remote[key] = "wrong";
      await expect(prepareGalleryPull(f)).rejects.toThrow("IDENTITY");
    },
  );
  it("rejects partial galleries", async () => {
    const f = fixture();
    f.remote.complete = false;
    await expect(prepareGalleryPull(f)).rejects.toThrow("IDENTITY");
  });
  it("rejects duplicate hashes", async () => {
    const f = fixture();
    f.remote.images[1].sha256 = a;
    await expect(prepareGalleryPull(f)).rejects.toThrow("CONTENT");
  });
  it("rejects changed image bytes", async () => {
    const f = fixture();
    f.remote.images[1].sha256 = "d".repeat(64);
    await expect(prepareGalleryPull(f)).rejects.toThrow("HASH_CHANGED");
  });
  it("rejects foreign media URL before download", async () => {
    const f = fixture();
    f.remote.images[0].url = "https://example.com/photo.jpg";
    await expect(prepareGalleryPull(f)).rejects.toThrow("IMAGE_REVIEW");
  });
});
