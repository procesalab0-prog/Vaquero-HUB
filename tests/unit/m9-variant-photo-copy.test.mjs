import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { prepareVariantPhotoCopy } from "../../scripts/m9/variant-photo-copy.mjs";
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const sha = createHash("sha256").update(bytes).digest("hex");
const url = "https://vaquerosm.com/wp-content/uploads/a.png";
const file = { base64: bytes.toString("base64"), sha256: sha };
function fixture() {
  return {
    product_id: "001f9757-61be-44e0-852c-8b0b38a486e9",
    items: [
      {
        variant_id: "a",
        photos: [
          {
            url,
            sha256: sha,
            bytes: bytes.length,
            mime: "image/png",
            alt: "talla22",
          },
        ],
        stored: null,
      },
    ],
  };
}
describe("variant storage copies", () => {
  it("shares file bytes but preserves separate variant bindings and alt", async () => {
    const f = fixture();
    f.items.push({
      ...f.items[0],
      variant_id: "b",
      photos: [{ ...f.items[0].photos[0], alt: "talla23" }],
    });
    let reads = 0;
    const r = await prepareVariantPhotoCopy(f, async () => {
      reads++;
      return file;
    });
    expect(reads).toBe(1);
    expect(r.files).toHaveLength(1);
    expect(r.items).toHaveLength(2);
    expect(r.items[1].photos[0].alt).toBe("talla23");
    expect(r.items[0].photos[0].url).toContain(`${f.product_id}/${sha}.png`);
  });
  it("does not invent parent images for missing variant photos", async () => {
    const f = fixture();
    f.items[0].photos = [];
    const r = await prepareVariantPhotoCopy(f, () => {
      throw Error("network");
    });
    expect(r.items).toEqual([]);
    expect(r.files).toEqual([]);
  });
  it("recognizes exact stored mappings without fetching", async () => {
    const f = fixture();
    const r = await prepareVariantPhotoCopy(f, async () => file);
    f.items[0].stored = r.items[0].photos.map((p) => ({
      alt: p.alt,
      url: p.url,
    }));
    expect(
      (
        await prepareVariantPhotoCopy(f, () => {
          throw Error("network");
        })
      ).files,
    ).toEqual([]);
  });
  it("rejects changed stored mappings", async () => {
    const f = fixture();
    f.items[0].stored = [{ url: "other", alt: "" }];
    await expect(prepareVariantPhotoCopy(f, async () => file)).rejects.toThrow(
      "ALREADY_EDITED",
    );
  });
  for (const [field, value, error] of [
    ["url", "https://evil.example/a.png", "PROOF"],
    ["sha256", "a".repeat(64), "BYTES_CHANGED"],
    ["bytes", 99, "BYTES_CHANGED"],
    ["mime", "image/svg+xml", "MIME"],
  ])
    it(`rejects changed ${field}`, async () => {
      const f = fixture();
      f.items[0].photos[0][field] = value;
      await expect(
        prepareVariantPhotoCopy(f, async () => file),
      ).rejects.toThrow(error);
    });
  it("rejects corrupt bytes even if supplied digest claims the original", async () => {
    await expect(
      prepareVariantPhotoCopy(fixture(), async () => ({
        ...file,
        base64: "YmFk",
      })),
    ).rejects.toThrow("BYTES_CHANGED");
  });
  it("rejects duplicate variant IDs", async () => {
    const f = fixture();
    f.items.push(f.items[0]);
    await expect(prepareVariantPhotoCopy(f, async () => file)).rejects.toThrow(
      "IDENTITY",
    );
  });
});
