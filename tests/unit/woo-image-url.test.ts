import { expect, it } from "vitest";
import { wooImageUrl } from "../../lib/woo-image-url";
it("accepts only commercial upload images from the original shop", () => {
  expect(
    wooImageUrl("https://vaquerosm.com/wp-content/uploads/2026/a.jpg"),
  ).toBe("https://vaquerosm.com/wp-content/uploads/2026/a.jpg");
});
it.each([
  "http://vaquerosm.com/wp-content/uploads/a.jpg",
  "https://vaquerosm.com.evil.test/wp-content/uploads/a.jpg",
  "https://user:pass@vaquerosm.com/wp-content/uploads/a.jpg",
  "https://vaquerosm.com:8443/wp-content/uploads/a.jpg",
  "https://vaquerosm.com/wp-admin/a.jpg",
  "https://vaquerosm.com/wp-content/uploads/../../../wp-admin/a.jpg",
  "javascript:alert(1)",
])("rejects unsafe cover %s", (url) =>
  expect(wooImageUrl(url)).toBeUndefined(),
);
