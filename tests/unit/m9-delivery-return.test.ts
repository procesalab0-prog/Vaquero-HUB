import { describe, expect, it } from "vitest";
import {
  deliveryCaptureQuery,
  deliveryEvidenceContextHref,
  deliveryReturnHref,
  deliveryReturnParams,
} from "@/lib/m9-delivery-capture";
const key = "a".repeat(64),
  ref = "11111111-1111-4111-8111-111111111111";
const source = deliveryCaptureQuery({
  q: "SYNTHETIC & /? #",
  filter: "identity",
  page: "2",
  document: key,
  review_filter: "all",
});
const evidence = () =>
  new URL(
    deliveryEvidenceContextHref({ client_ref: ref, document_key: key }, source),
    "https://preview.invalid",
  );
describe("bounded delivery evidence return context", () => {
  it("round trips the exact page2 query, both filters, document and safe anchor", () => {
    const url = evidence();
    expect(url.pathname).toBe("/migracion/creditos");
    expect(url.searchParams.get("q")).toBe(ref);
    expect(url.searchParams.get("document")).toBe(key);
    expect(url.hash).toBe(`#documento-${key}`);
    const back = new URL(
      deliveryReturnHref(Object.fromEntries(url.searchParams))!,
      url.origin,
    );
    expect(back.pathname).toBe("/migracion/entregas");
    expect(Object.fromEntries(back.searchParams)).toEqual({
      ...source,
      page: "2",
    });
    expect(back.hash).toBe("#documentos");
  });
  it("does not add a return link to direct credit visits or accept arbitrary return URLs", () => {
    for (const params of [
      {},
      { returnURL: "https://evil.invalid" },
      { delivery_return: "https://evil.invalid" },
      { delivery_return: ["1", "https://evil.invalid"] },
    ])
      expect(deliveryReturnHref(params)).toBeNull();
  });
  it("ignores arbitrary return URLs even beside a valid context and encodes searches as text", () => {
    const params = {
      delivery_return: "1",
      returnURL: "javascript:alert(1)",
      delivery_q: "https://evil.invalid/#x",
      delivery_page: "2",
    };
    const back = new URL(
      deliveryReturnHref(params)!,
      "https://preview.invalid",
    );
    expect(back.origin).toBe("https://preview.invalid");
    expect(back.pathname).toBe("/migracion/entregas");
    expect(back.searchParams.get("q")).toBe("https://evil.invalid/#x");
    expect(back.hash).toBe("#documentos");
    expect(back.searchParams.has("returnURL")).toBe(false);
  });
  it.each(["q", "filter", "page", "document", "review_filter"])(
    "rejects repeated/non-string %s context",
    (field) => {
      expect(
        deliveryReturnParams({
          delivery_return: "1",
          [`delivery_${field}`]: ["x", "y"],
        }),
      ).toBeNull();
    },
  );
  it("clamps text and normalizes invalid filters/page/document without changing route", () => {
    const back = new URL(
      deliveryReturnHref({
        delivery_return: "1",
        delivery_q: "x".repeat(200),
        delivery_filter: "https://evil.invalid",
        delivery_page: "999999999",
        delivery_document: "javascript:alert(1)",
        delivery_review_filter: "concrete#evil",
      })!,
      "https://preview.invalid",
    );
    expect(Object.fromEntries(back.searchParams)).toEqual({
      q: "x".repeat(100),
      filter: "all",
      page: "1",
      review_filter: "pending",
    });
  });
});
