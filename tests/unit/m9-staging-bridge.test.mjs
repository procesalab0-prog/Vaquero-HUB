import { describe, it, expect } from "vitest";
import {
  sourceImage,
  imageType,
  claimedInput,
} from "../../scripts/m9/woo-test/staging-bridge.mjs";
import { sampleInput } from "../../scripts/m9/woo-test/fixtures.mjs";
function claim() {
  const i = sampleInput();
  const v = { ...i.variants[0], active: true, attributes: {} };
  return {
    id: "11111111-1111-4111-8111-111111111111",
    claim_id: "22222222-2222-4222-8222-222222222222",
    state: "RUNNING",
    packet: {
      version: 1,
      store: i.store,
      product_id: i.product_id,
      revision: 1,
      mode: "create",
      type: "simple",
      content: {
        ...i.content,
        images: [
          { url: "https://vaquerosm.com/wp-content/uploads/test.jpg", alt: "" },
        ],
      },
      category_evidence: { valid: true },
      catalog: { product_id: i.product_id, active: true, variants: [v] },
    },
  };
}
describe("supervised staging bridge", () => {
  it("preserves barcode zeros and excludes production links and inventory", () => {
    const c = claim();
    c.packet.catalog.variants[0].woo_product_id = 19771;
    const p = claimedInput(c);
    expect(p.variants[0].barcode).toBe("000007779");
    expect(p).not.toHaveProperty("target");
    expect(p.variants[0]).not.toHaveProperty("woo_product_id");
    expect(p.variants[0]).not.toHaveProperty("stock_quantity");
  });
  it("requires a claimed job with valid evidence", () => {
    const c = claim();
    c.state = "READY";
    expect(() => claimedInput(c)).toThrow("CLAIM_REQUIRED");
    c.state = "RUNNING";
    c.packet.category_evidence.valid = false;
    expect(() => claimedInput(c)).toThrow("CLAIM_REVIEW_REQUIRED");
  });
  it("refuses a live destination", () => {
    const c = claim();
    c.packet.store.base_url = "https://vaquerosm.com";
    expect(() => claimedInput(c)).toThrow("LOCAL_ONLY");
  });
  it("refuses inactive, variable or duplicate candidates", () => {
    const c = claim();
    c.packet.catalog.variants.push(c.packet.catalog.variants[0]);
    expect(() => claimedInput(c)).toThrow("CLAIM_REVIEW_REQUIRED");
  });
  it("restricts image downloads to allowlisted public paths", () => {
    for (const url of [
      "http://vaquerosm.com/wp-content/uploads/x.jpg",
      "https://evil.test/x.jpg",
      "https://vaquerosm.com@evil.test/wp-content/uploads/x.jpg",
      "https://vaquerosm.com/wp-admin/x",
      "https://vaquerosm.com/wp-content/uploads/../../wp-admin/x",
      "https://vaquerosm.com:444/wp-content/uploads/x.jpg",
    ])
      expect(() => sourceImage(url)).toThrow();
  });
  it("detects actual image bytes instead of trusting the file extension", () => {
    expect(imageType(Buffer.from("RIFF1234WEBP"))).toEqual([
      "image/webp",
      "webp",
    ]);
    expect(() => imageType(Buffer.from("<html>"))).toThrow(
      "UNSUPPORTED_IMAGE_BYTES",
    );
  });
});
