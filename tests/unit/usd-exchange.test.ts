import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  calculateUsdTender,
  parseBanxicoFix,
  parseExchangeRate,
  BANXICO_FIX_URL,
} from "@/lib/usd-exchange";
import { fetchBanxicoFix } from "@/lib/banxico-server";
const payload = (
  rows: Array<{ fecha: string; dato: string }>,
  idSerie = "SF43718",
) => ({ bmx: { series: [{ idSerie, datos: rows }] } });
it("uses exact six-decimal rates and rejects rounding or non-finite syntax", () => {
  expect(parseExchangeRate("19.234567")).toBe(19234567);
  expect(parseExchangeRate("-0,50", true)).toBe(-500000);
  expect(parseExchangeRate("0", true)).toBe(0);
  for (const value of [
    "0",
    "-20",
    "1e2",
    "NaN",
    "Infinity",
    "19.1234567",
    "1,000.25",
    "1001",
    "9".repeat(100),
  ])
    expect(parseExchangeRate(value)).toBeNull();
});
it("selects only FIX, the latest valid date, and never a future or impossible date", () => {
  const rows = [
    { fecha: "01/10/2026", dato: "19.1234" },
    { fecha: "02/10/2026", dato: "N/E" },
    { fecha: "03/10/2026", dato: "20" },
    { fecha: "31/02/2026", dato: "20" },
  ];
  expect(parseBanxicoFix(payload(rows), "2026-10-02")).toEqual({
    date: "2026-10-01",
    rateMillion: 19123400,
  });
  expect(parseBanxicoFix(payload(rows, "SF60653"), "2026-10-02")).toBeNull();
  for (const malformed of [null, {}, { bmx: { series: null } }, payload([])])
    expect(parseBanxicoFix(malformed, "2026-10-02")).toBeNull();
});
it("keeps USD received separate from MXN change and rounds exactly in cents", () => {
  expect(calculateUsdTender(10000, 19234567, 190000)).toEqual({
    usdCents: 10000,
    equivalentMxnCents: 192346,
    changeMxnCents: 2346,
    refundCurrency: "MXN",
  });
  expect(calculateUsdTender(1, 19500000, 1)?.equivalentMxnCents).toBe(20);
  for (const args of [
    [100, 20000000, 2001],
    [0, 20000000, 1],
    [1.5, 20000000, 1],
    [Number.MAX_SAFE_INTEGER, 1000000000, 1],
  ])
    expect(
      calculateUsdTender(...(args as [number, number, number])),
    ).toBeNull();
});
it("sends the token only in a header to the fixed official endpoint", async () => {
  const token = "a".repeat(64);
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify(payload([{ fecha: "02/10/2026", dato: "19.2345" }])),
      ),
  );
  expect(await fetchBanxicoFix(token, "2026-10-02", request)).toEqual({
    date: "2026-10-02",
    rateMillion: 19234500,
  });
  expect(request.mock.calls[0]?.[0]).toBe(BANXICO_FIX_URL);
  const options = (request.mock.calls as unknown[][])[0][1] as RequestInit;
  expect(options.headers).toEqual({
    Accept: "application/json",
    "Bmx-Token": token,
  });
  expect(options.redirect).toBe("error");
  expect(options.cache).toBe("no-store");
});
it("does not fetch with an invalid token and fails closed on upstream errors", async () => {
  const request = vi.fn(async () => new Response("error", { status: 500 }));
  expect(await fetchBanxicoFix("invalid", "2026-10-02", request)).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(
    await fetchBanxicoFix("a".repeat(64), "2026-10-02", request),
  ).toBeNull();
  expect(
    await fetchBanxicoFix(
      "a".repeat(64),
      "2026-10-02",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    ),
  ).toBeNull();
});
