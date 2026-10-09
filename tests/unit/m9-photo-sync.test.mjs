import { describe, expect, it } from "vitest";
import { TEST_ORIGIN } from "../../scripts/m9/woo-remote/client.mjs";
import {
  photoIdentityHash,
  planPhotoSync,
  assertPhotoPlanFresh,
} from "../../scripts/m9/woo-remote/photo-sync.mjs";

const binding = {
  origin: TEST_ORIGIN,
  product_id: "f4291151-09fc-429a-9e36-ccc214c32acb",
  woo_product_id: 14,
  barcodes: ["00010521"],
  match: "verified",
  evidence_sha256: "a".repeat(64),
};
const image = (digit, alt = "Foto") => ({ sha256: digit.repeat(64), alt });
const gallery = (images, revision = "1") => ({
  identity_sha256: photoIdentityHash(binding),
  complete: true,
  revision,
  images,
});
const baseline = () => ({
  identity_sha256: photoIdentityHash(binding),
  miTienda: gallery([image("1")]),
  woo: gallery([image("1")]),
});
const request = () => ({
  binding,
  miTienda: gallery([image("1")]),
  woo: gallery([image("1"), image("2")], "2"),
  baseline: baseline(),
});

describe("bidirectional photo reconciliation (read only)", () => {
  it("pulls photos added in Woo and is deterministic", () => {
    const first = planPhotoSync(request());
    expect(first.action).toBe("PULL_FROM_WOO");
    expect(first.writes_performed).toBe(0);
    expect(planPhotoSync(request())).toEqual(first);
  });
  it("pushes photos added in Mi Tienda", () => {
    const p = request();
    [p.miTienda, p.woo] = [p.woo, p.miTienda];
    expect(planPhotoSync(p).action).toBe("PUSH_TO_WOO");
  });
  it("recognizes identical bytes despite different URLs and remote IDs", () => {
    const p = request();
    p.miTienda.images = [{ ...image("1"), url: "local", id: 44 }];
    p.woo.images = [{ ...image("1"), url: "woo", id: 15 }];
    expect(planPhotoSync(p).action).toBe("IN_SYNC");
  });
  it("imports the initial Woo gallery only into an empty gallery", () => {
    const p = { ...request(), baseline: null, miTienda: gallery([]) };
    expect(planPhotoSync(p).action).toBe("PULL_FROM_WOO");
    p.miTienda = gallery([image("3")]);
    expect(planPhotoSync(p).reason).toBe("INITIAL_GALLERIES_DIFFER");
  });
  it("starts from Mi Tienda when Woo is empty", () => {
    expect(
      planPhotoSync({ ...request(), baseline: null, woo: gallery([]) }).action,
    ).toBe("PUSH_TO_WOO");
  });
  it("does nothing when both galleries are empty", () => {
    expect(
      planPhotoSync({ binding, miTienda: gallery([]), woo: gallery([]) })
        .action,
    ).toBe("IN_SYNC");
  });
  it("does not overwrite simultaneous independent additions", () => {
    const p = request();
    p.miTienda = gallery([image("1"), image("3")], "2");
    expect(planPhotoSync(p).reason).toBe("BOTH_SIDES_CHANGED");
  });
  it.each([{ images: [] }, { images: [image("3")] }])(
    "requires review for removal/replacement %j",
    ({ images }) => {
      const p = request();
      p.woo = gallery(images, "2");
      expect(planPhotoSync(p).reason).toBe(
        "REMOVAL_OR_REPLACEMENT_REQUIRES_REVIEW",
      );
    },
  );
  it("tracks cover/order and alt changes", () => {
    const p = request();
    p.miTienda = gallery([image("1"), image("2")]);
    p.baseline.miTienda = p.miTienda;
    p.baseline.woo = p.miTienda;
    p.woo = gallery([image("2"), image("1")], "2");
    expect(planPhotoSync(p).action).toBe("PULL_FROM_WOO");
    p.woo = gallery([image("1", "New alt"), image("2")], "2");
    expect(planPhotoSync(p).action).toBe("PULL_FROM_WOO");
  });
  it.each(["https://vaquerosm.com", TEST_ORIGIN + ".evil.test"])(
    "never plans writes for %s",
    (origin) => {
      expect(() =>
        planPhotoSync({ ...request(), binding: { ...binding, origin } }),
      ).toThrow("VERIFIED_TEST_BINDING_REQUIRED");
    },
  );
  it("rejects name-only matches, duplicate barcodes and numeric barcodes", () => {
    for (const change of [
      { match: "name" },
      { barcodes: [10521] },
      { barcodes: ["1", "1"] },
    ]) {
      expect(() =>
        planPhotoSync({ ...request(), binding: { ...binding, ...change } }),
      ).toThrow();
    }
    expect(photoIdentityHash(binding)).not.toBe(
      photoIdentityHash({ ...binding, barcodes: ["10521"] }),
    );
  });
  it("rejects a different product/store evidence or partial gallery", () => {
    const p = request();
    p.woo.identity_sha256 = "f".repeat(64);
    expect(() => planPhotoSync(p)).toThrow("GALLERY_IDENTITY_MISMATCH");
    p.woo = { ...gallery([]), complete: false };
    expect(() => planPhotoSync(p)).toThrow("COMPLETE_GALLERY_REQUIRED");
  });
  it("rejects duplicate content and invalid hashes", () => {
    const p = request();
    p.woo = gallery([image("1"), image("1")]);
    expect(() => planPhotoSync(p)).toThrow("DUPLICATE_GALLERY_IMAGE");
    p.woo = gallery([{ sha256: "missing", alt: "" }]);
    expect(() => planPhotoSync(p)).toThrow("INVALID_GALLERY_IMAGE");
  });
  it("rejects a baseline that was never synchronized", () => {
    const p = request();
    p.baseline.woo = gallery([image("2")]);
    expect(() => planPhotoSync(p)).toThrow("BASELINE_NOT_SYNCHRONIZED");
  });
  it("rejects stale revisions even if images did not change", () => {
    const p = request();
    const plan = planPhotoSync(p);
    expect(assertPhotoPlanFresh(plan, p)).toEqual(plan);
    p.miTienda.revision = "2";
    expect(() => assertPhotoPlanFresh(plan, p)).toThrow(
      "PHOTO_PLAN_STALE_OR_CHANGED",
    );
  });
  it("rejects tampered direction and stale target images", () => {
    const p = request();
    const plan = planPhotoSync(p);
    expect(() =>
      assertPhotoPlanFresh({ ...plan, action: "PUSH_TO_WOO" }, p),
    ).toThrow();
    p.miTienda.images = [image("3")];
    expect(() => assertPhotoPlanFresh(plan, p)).toThrow();
  });
  it("cannot execute a review or already synchronized plan", () => {
    const p = request();
    p.woo = p.miTienda;
    expect(() => assertPhotoPlanFresh(planPhotoSync(p), p)).toThrow(
      "PHOTO_PLAN_NOT_ACTIONABLE",
    );
  });
});
