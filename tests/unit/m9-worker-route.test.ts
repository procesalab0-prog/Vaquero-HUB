import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
vi.mock("@/lib/m9-woo-worker-server", () => ({ runWooTrialQueue: vi.fn() }));
import { runWooTrialQueue } from "@/lib/m9-woo-worker-server";
import { POST } from "@/app/api/m9/woo-worker/route";
import { WEB_STAGING_URL } from "@/lib/web-draft";
const token = "a".repeat(64);
const request = (body = "{}", auth = `Bearer ${token}`) =>
  new Request("https://preview.example/api/m9/woo-worker", {
    method: "POST",
    body,
    headers: { Authorization: auth },
  });
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", WEB_STAGING_URL);
  vi.stubEnv(
    "M9_WORKER_TOKEN_SHA256",
    createHash("sha256").update(token).digest("hex"),
  );
  vi.mocked(runWooTrialQueue).mockReset().mockResolvedValue({ state: "IDLE" });
});
describe("private worker HTTP boundary", () => {
  it("is absent in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await POST(request())).status).toBe(404);
    expect(runWooTrialQueue).not.toHaveBeenCalled();
  });
  it("is absent with another database", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://production.invalid");
    expect((await POST(request())).status).toBe(404);
    expect(runWooTrialQueue).not.toHaveBeenCalled();
  });
  it("rejects an unauthenticated request", async () => {
    expect((await POST(request("{}", ""))).status).toBe(401);
    expect(runWooTrialQueue).not.toHaveBeenCalled();
  });
  it("rejects arbitrary commands or actors", async () => {
    expect((await POST(request('{"actor_id":"someone"}'))).status).toBe(400);
    expect(runWooTrialQueue).not.toHaveBeenCalled();
  });
  it("requires the exact empty command", async () => {
    expect((await POST(request(""))).status).toBe(400);
    expect(runWooTrialQueue).not.toHaveBeenCalled();
  });
  it("returns only the public state and never caches it", async () => {
    vi.mocked(runWooTrialQueue).mockResolvedValue({
      state: "READY",
      id: "private-job",
    });
    const r = await POST(request());
    expect(await r.json()).toEqual({ state: "READY" });
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("fails closed when the window is not open", async () => {
    vi.mocked(runWooTrialQueue).mockRejectedValue(
      Error("WORKER_WINDOW_REQUIRED"),
    );
    expect((await POST(request())).status).toBe(409);
  });
  it("sanitizes an internal failure", async () => {
    vi.mocked(runWooTrialQueue).mockRejectedValue(Error("private details"));
    const r = await POST(request());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ code: "WORKER_REVIEW_REQUIRED" });
  });
});
