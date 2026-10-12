import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "../../lib/request-origin";

function check(headers: Record<string, string>, protocol = "http:") {
  return isSameOriginRequest({
    headers: new Headers(headers),
    nextUrl: { protocol },
  });
}

describe("browser-facing request origin", () => {
  it("accepts the browser host even when Next uses an internal URL", () => {
    expect(
      check({ host: "127.0.0.1:5941", origin: "http://127.0.0.1:5941" }),
    ).toBe(true);
  });
  it("accepts HTTPS through the deployment proxy", () => {
    expect(
      check({
        host: "vaquero-hub.vercel.app",
        origin: "https://vaquero-hub.vercel.app",
        "x-forwarded-proto": "https",
      }),
    ).toBe(true);
  });
  it.each([
    {},
    { origin: "null" },
    { origin: "https://outside.invalid" },
    { origin: "http://vaquero-hub.vercel.app" },
    { origin: "https://vaquero-hub.vercel.app/" },
    { origin: "https://user@vaquero-hub.vercel.app" },
    { origin: "https://vaquero-hub.vercel.app?x=1" },
    { origin: "https://vaquero-hub.vercel.app:444" },
    {
      origin: "https://outside.invalid",
      "x-forwarded-host": "outside.invalid",
    },
    {
      origin: "https://vaquero-hub.vercel.app",
      "x-forwarded-proto": "https,http",
    },
    {
      origin: "https://vaquero-hub.vercel.app",
      "x-forwarded-proto": "javascript",
    },
    {
      origin: "https://vaquero-hub.vercel.app",
      host: "vaquero-hub.vercel.app/path",
    },
  ])("rejects foreign, missing or malformed origins: %j", (overrides) => {
    expect(
      check({
        host: "vaquero-hub.vercel.app",
        "x-forwarded-proto": "https",
        ...overrides,
      } as Record<string, string>),
    ).toBe(false);
  });
});
