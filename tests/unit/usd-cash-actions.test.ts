import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.authorize,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import {
  closeCashSession,
  previewCashClose,
} from "../../app/(workspace)/caja/actions";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: {}, error: null });
});
describe("corte con monedas separadas", () => {
  it("no modifica la operación de una caja que sólo tiene pesos", async () => {
    await closeCashSession({ sessionId: "own-session", countedAmount: 125.5 });
    expect(mocks.rpc).toHaveBeenCalledWith("close_cash_session", {
      p_session_id: "own-session",
      p_counted_amount_cents: 12550,
      p_difference_reason: null,
    });
  });
  it("el conteo USD cero no se confunde con un conteo ausente", async () => {
    await closeCashSession({
      sessionId: "own-session",
      countedAmount: 125.5,
      countedUsd: 0,
      reason: "Faltante QA",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("close_cash_session_with_usd", {
      p_session_id: "own-session",
      p_counted_mxn_cents: 12550,
      p_counted_usd_cents: 0,
      p_difference_reason: "Faltante QA",
    });
  });
  it("envía ambos conteos físicos antes de mostrar el esperado", async () => {
    await previewCashClose("own-session", 125.5, 7.25);
    expect(mocks.rpc).toHaveBeenCalledWith("preview_cash_close_with_usd", {
      p_session_id: "own-session",
      p_counted_mxn_cents: 12550,
      p_counted_usd_cents: 725,
    });
  });
  it("explica el motivo faltante también para errores de PostgREST", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "DIFFERENCE_REASON_REQUIRED" },
    });
    expect(
      await closeCashSession({
        sessionId: "own-session",
        countedAmount: 0,
        countedUsd: 0,
      }),
    ).toEqual({
      ok: false,
      message: "Explica la diferencia antes de cerrar la caja.",
    });
  });
  it("sin permiso no llama ningún cierre ni consulta de saldos", async () => {
    mocks.authorize.mockRejectedValue(new Error("NOT_AUTHORIZED"));
    expect((await previewCashClose("own-session", 0, 0)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
