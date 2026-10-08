import "server-only";
import {
  BANXICO_FIX_URL,
  parseBanxicoFix,
  type FixObservation,
} from "./usd-exchange";

/** Fixed official endpoint: no caller-supplied URL and no token in query/logs. */
export async function fetchBanxicoFix(
  token: string,
  today: string,
  request: typeof fetch = fetch,
): Promise<FixObservation | null> {
  if (!/^[a-zA-Z0-9]{64}$/.test(token)) return null;
  try {
    const response = await request(BANXICO_FIX_URL, {
      headers: { Accept: "application/json", "Bmx-Token": token },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = await response.text();
    if (body.length > 65_536) return null;
    return parseBanxicoFix(JSON.parse(body), today);
  } catch {
    return null;
  }
}
