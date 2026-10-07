import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpc: vi.fn(),
  admin: vi.fn(),
  record: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.authorize,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/banxico-server", () => ({ fetchBanxicoFix: mocks.fetch }));
import { prepareUsdExchange } from "../../app/(workspace)/pos/usd-actions";

describe("referencia USD desde servidor", () => {
  const quote = {
    id: "quote",
    reference_date: "2026-10-02",
    rate_million: 20000000,
    refund_currency: "MXN",
    refund_rate: "ORIGINAL_SALE",
  };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("BANXICO_SIE_TOKEN", "a".repeat(64));
    vi.stubEnv("SUPABASE_SECRET_KEY", "qa-placeholder");
    mocks.authorize.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
    mocks.admin.mockReturnValue({ rpc: mocks.record });
    mocks.rpc.mockImplementation(async (name: string) => ({
      data:
        name === "get_my_cash_session"
          ? { id: "own-session" }
          : name === "usd_checkout_available"
            ? true
            : quote,
      error: null,
    }));
    mocks.fetch.mockResolvedValue({
      date: "2026-10-02",
      rateMillion: 20000000,
    });
    mocks.record.mockResolvedValue({ data: "reference", error: null });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("rechaza otra caja antes de consultar Banxico o crear un cliente privilegiado", async () => {
    expect((await prepareUsdExchange("other-session")).ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("sin permiso no consulta datos externos", async () => {
    mocks.authorize.mockRejectedValue(new Error("NOT_AUTHORIZED"));
    expect((await prepareUsdExchange("own-session")).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("registra el FIX con servidor y obtiene la tasa autorizada con la sesión del usuario", async () => {
    expect(await prepareUsdExchange("own-session")).toEqual({
      ok: true,
      quote,
      source: "BANXICO",
    });
    expect(mocks.record).toHaveBeenCalledWith("record_banxico_fix", {
      p_date: "2026-10-02",
      p_rate_million: 20000000,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_usd_exchange_quote", {
      p_cash_session_id: "own-session",
    });
  });
  it("si Banxico no responde usa sólo la referencia validada por la base", async () => {
    mocks.fetch.mockResolvedValue(null);
    expect(await prepareUsdExchange("own-session")).toEqual({
      ok: true,
      quote,
      source: "LAST_VALID_REFERENCE",
    });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("no presenta una observación rechazada como una referencia nueva", async () => {
    mocks.record.mockResolvedValue({
      data: null,
      error: { message: "BANXICO_REFERENCE_CONFLICT" },
    });
    expect(await prepareUsdExchange("own-session")).toEqual({
      ok: true,
      quote,
      source: "LAST_VALID_REFERENCE",
    });
  });
  it("sin token y sin referencia disponible bloquea, no inventa una tasa", async () => {
    vi.stubEnv("BANXICO_SIE_TOKEN", "");
    mocks.rpc
      .mockResolvedValueOnce({ data: { id: "own-session" }, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "FX_REFERENCE_UNAVAILABLE" },
      });
    expect((await prepareUsdExchange("own-session")).ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("el interruptor desactivado impide incluso la consulta externa", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { id: "own-session" }, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    expect((await prepareUsdExchange("own-session")).ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
