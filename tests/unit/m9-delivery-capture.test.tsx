import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  captureRequest,
  assertCaptureOrigin,
  isCaptureReceipt,
  type CaptureContext,
} from "@/lib/m9-delivery-capture";
import { CUSTOMER_REVIEW_STAGING_URL } from "@/lib/customer-migration";
const m = vi.hoisted(() => ({
  permission: vi.fn(),
  rpc: vi.fn(),
  headers: vi.fn(),
  revalidate: vi.fn(),
  refresh: vi.fn(),
  state: { status: "idle", message: "" },
  actionSeen: vi.fn(),
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: m.permission,
}));
vi.mock("next/headers", () => ({ headers: m.headers }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh }),
}));
vi.mock("react", async (load) => ({
  ...(await load<typeof import("react")>()),
  useActionState: (action: unknown) => {
    m.actionSeen(action);
    return [m.state, () => {}, false];
  },
}));
import { saveDeliveryObservation } from "../../app/(workspace)/migracion/entregas/actions";
import { DeliveryCaptureForm } from "../../app/(workspace)/migracion/entregas/capture-form";
const id = "11111111-1111-4111-8111-111111111111",
  key = "a".repeat(64),
  ctx: CaptureContext = {
    archive_payload_hash: "b".repeat(64),
    document_snapshot_hash: "c".repeat(64),
    revision: 0,
    latest_request_id: null,
    latest_action: null,
    status: "NONE",
  };
function form() {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: id,
    archive_sha256: key,
    document_key: key,
    expected_archive_payload_hash: ctx.archive_payload_hash,
    expected_document_snapshot_hash: ctx.document_snapshot_hash,
    expected_revision: "0",
    action: "OBSERVE",
    choice: "UNKNOWN",
    revokes_request_id: "",
    confirmed: "yes",
  }))
    f.set(k, v);
  return f;
}
const receipt = {
  protocol: "m9-delivery-capture-receipt-1",
  request_id: id,
  document_key: key,
  revision: 1,
  documentary_only: true,
  operational_import_allowed: false,
  stock_delivery_allowed: false,
  financial_opening_allowed: false,
  source_delivery_status: "UNKNOWN",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.state = { status: "idle", message: "" };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", CUSTOMER_REVIEW_STAGING_URL);
  m.headers.mockResolvedValue(
    new Headers({
      origin: "https://preview.example.com",
      host: "preview.example.com",
    }),
  );
  m.permission.mockResolvedValue({
    profile: { is_active: true, roles: { code: "ADMIN" } },
    supabase: { rpc: m.rpc },
  });
  m.rpc.mockResolvedValue({ data: receipt, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("uses only reviewed hashes/revision, explicit choice and confirmation", () => {
  expect(captureRequest(form())).toEqual({
    protocol: "m9-delivery-capture-request-1",
    request_id: id,
    archive_sha256: key,
    document_key: key,
    expected_archive_payload_hash: ctx.archive_payload_hash,
    expected_document_snapshot_hash: ctx.document_snapshot_hash,
    expected_revision: 0,
    action: "OBSERVE",
    choice: "UNKNOWN",
    revokes_request_id: null,
    confirmed: true,
  });
});
it.each([
  "request_id",
  "archive_sha256",
  "document_key",
  "expected_archive_payload_hash",
  "expected_document_snapshot_hash",
  "expected_revision",
  "action",
  "choice",
  "confirmed",
])("rejects malformed %s", (field) => {
  const f = form();
  f.set(field, "bad");
  expect(() => captureRequest(f)).toThrow();
});
it("rejects missing or duplicate confirmations, not merely truthy text", () => {
  const f = form();
  f.delete("confirmed");
  expect(() => captureRequest(f)).toThrow();
  f.append("confirmed", "yes");
  f.append("confirmed", "yes");
  expect(() => captureRequest(f)).toThrow();
});
it("undo is an explicit separate request with target event", () => {
  const f = form();
  f.set("action", "REVOKE");
  f.set("choice", "");
  f.set("revokes_request_id", id);
  expect(captureRequest(f).action).toBe("REVOKE");
  f.set("choice", "UNKNOWN");
  expect(() => captureRequest(f)).toThrow();
});
it.each([
  [null, "p.example"],
  ["https://evil.example", "p.example"],
  ["null", "p.example"],
  ["http://p.example", "p.example"],
  ["https://p.example/path", "p.example"],
  ["https://p.example", "p.example,evil.example"],
])("rejects cross-site/missing origin %s", (origin, host) =>
  expect(() => assertCaptureOrigin(origin, host)).toThrow(),
);
it("permits exact HTTPS origin and local-only HTTP", () => {
  expect(() =>
    assertCaptureOrigin("https://p.example", "p.example"),
  ).not.toThrow();
  expect(() =>
    assertCaptureOrigin("http://localhost:3000", "localhost:3000"),
  ).not.toThrow();
});
it("protects production before session or RPC", async () => {
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "https://drubkjlmfbdeglucakmg.supabase.co",
  );
  expect((await saveDeliveryObservation(m.state as never, form())).status).toBe(
    "error",
  );
  expect(m.permission).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects CSRF before session and write", async () => {
  m.headers.mockResolvedValue(
    new Headers({
      origin: "https://evil.example",
      host: "preview.example.com",
    }),
  );
  expect((await saveDeliveryObservation(m.state as never, form())).status).toBe(
    "error",
  );
  expect(m.permission).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});
it.each(["CASHIER", "MANAGER", "WAREHOUSE"])(
  "never writes for permitted non-ADMIN %s",
  async (code) => {
    m.permission.mockResolvedValue({
      profile: { roles: { code } },
      supabase: { rpc: m.rpc },
    });
    expect(
      (await saveDeliveryObservation(m.state as never, form())).status,
    ).toBe("error");
    expect(m.rpc).not.toHaveBeenCalled();
  },
);
it("requires permission before write and accepts ADMIN relation array", async () => {
  m.permission.mockRejectedValueOnce(Error("NOT_AUTHORIZED"));
  expect((await saveDeliveryObservation(m.state as never, form())).status).toBe(
    "error",
  );
  expect(m.rpc).not.toHaveBeenCalled();
  m.permission.mockResolvedValueOnce({
    profile: { roles: [{ code: "ADMIN" }] },
    supabase: { rpc: m.rpc },
  });
  expect((await saveDeliveryObservation(m.state as never, form())).status).toBe(
    "saved",
  );
  expect(m.rpc).toHaveBeenCalledWith("m9_delivery_capture_write", {
    p_input: captureRequest(form()),
  });
  expect(m.revalidate).toHaveBeenCalledWith("/migracion/entregas");
});
it("never forwards actor, server timestamp, physical quantities or arbitrary document", async () => {
  const f = form();
  f.set("actor", "imposter");
  f.set("delivered_qty", "5");
  f.set("document", JSON.stringify({ id: "spoof" }));
  await saveDeliveryObservation(m.state as never, f);
  const p = m.rpc.mock.calls[0][1].p_input;
  expect(p.actor).toBeUndefined();
  expect(p.delivered_qty).toBeUndefined();
  expect(p.document).toBeUndefined();
  expect(p.reviewed_at).toBeUndefined();
});
it("does not echo private SQL errors or claim success after unsafe receipt", async () => {
  m.rpc.mockResolvedValue({
    data: null,
    error: { message: "PRIVATE CUSTOMER PII" },
  });
  const r = await saveDeliveryObservation(m.state as never, form());
  expect(r.status).toBe("error");
  expect(r.message).not.toContain("PRIVATE");
  expect(m.revalidate).not.toHaveBeenCalled();
  expect(isCaptureReceipt({ ...receipt, stock_delivery_allowed: true })).toBe(
    false,
  );
});
it("has no selected default and requires a separate confirmation", () => {
  const html = renderToStaticMarkup(
    <DeliveryCaptureForm
      saveAction={saveDeliveryObservation}
      archive={key}
      document={key}
      context={ctx}
      generic={false}
      requestId={id}
      revokeRequestId={id}
    />,
  );
  expect(m.actionSeen).toHaveBeenCalledWith(saveDeliveryObservation);
  expect(html.match(/type="radio"/g)).toHaveLength(4);
  expect(html).not.toContain('checked=""');
  expect(html).toContain('type="checkbox" required=""');
  expect(html).toContain('name="expected_document_snapshot_hash"');
  expect(html).toContain('disabled=""');
  expect(html).toContain("no una orden de entrega o cobro");
});
it("disables all-physical declarations on generic debt", () => {
  const html = renderToStaticMarkup(
    <DeliveryCaptureForm
      saveAction={saveDeliveryObservation}
      archive={key}
      document={key}
      context={ctx}
      generic
      requestId={id}
      revokeRequestId={id}
    />,
  );
  expect(html).toMatch(
    /value="ALL_PENDING"[^>]*disabled=""|disabled=""[^>]*value="ALL_PENDING"/,
  );
  expect(html).toMatch(
    /value="ALL_DELIVERED"[^>]*disabled=""|disabled=""[^>]*value="ALL_DELIVERED"/,
  );
  expect(html).not.toContain("2 pza");
  expect(html).toContain("no conocemos sus piezas físicas");
});
