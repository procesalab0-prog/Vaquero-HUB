import { describe, it, expect } from "vitest";
import { prepareGalleryPush } from "../../scripts/m9/woo-remote/push-gallery.mjs";
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
      ],
    },
    current: {
      images: [
        { url: "https://local/a.jpg", alt: "Cambio local" },
        { url: "https://local/b.jpg", alt: "Nueva" },
      ],
    },
    checkpoint: [{ sha256: a, alt: "" }],
    readPhoto: async (url) => ({
      sha256: url.endsWith("b.jpg") ? b : a,
      base64: Buffer.from("image").toString("base64"),
    }),
  };
}
describe("outbound gallery plan", () => {
  it("preserves order, original barcode identity and edited alt", async () => {
    const p = await prepareGalleryPush(fixture());
    expect(p.common).toEqual([
      { sha256: a, alt: "Cambio local" },
      { sha256: b, alt: "Nueva" },
    ]);
  });
  it("requires a previously verified common gallery", async () => {
    const f = fixture();
    f.checkpoint = null;
    await expect(prepareGalleryPush(f)).rejects.toThrow("CHECKPOINT_REQUIRED");
  });
  it("blocks remote edits instead of overwriting them", async () => {
    const f = fixture();
    f.remote.images[0].alt = "Woo edit";
    await expect(prepareGalleryPush(f)).rejects.toThrow("BOTH_CHANGED");
  });
  it("blocks removal of a common photo", async () => {
    const f = fixture();
    f.current.images.shift();
    await expect(prepareGalleryPush(f)).rejects.toThrow("REMOVAL");
  });
  it("recognizes identical galleries", async () => {
    const f = fixture();
    f.current.images = [{ url: "https://local/a.jpg", alt: "" }];
    expect((await prepareGalleryPush(f)).unchanged).toBe(true);
  });
  it("blocks identity changes", async () => {
    const f = fixture();
    f.remote.barcode = "12";
    await expect(prepareGalleryPush(f)).rejects.toThrow("IDENTITY");
  });
  it("blocks duplicate local photos", async () => {
    const f = fixture();
    f.current.images.push(f.current.images[0]);
    await expect(prepareGalleryPush(f)).rejects.toThrow("CONTENT");
  });
});
