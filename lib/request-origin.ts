/** Check the browser-facing Host, not Next's internal URL behind a proxy. */
export function isSameOriginRequest(request: {
  headers: Headers;
  nextUrl: { protocol: string };
}): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProtocol
    ? `${forwardedProtocol}:`
    : request.nextUrl.protocol;
  if (!origin || !host || !["http:", "https:"].includes(protocol)) return false;
  try {
    const source = new URL(origin);
    const target = new URL(`${protocol}//${host}`);
    // Reject malformed authorities and non-canonical Origin headers. Never use
    // x-forwarded-host: a caller must not choose the host we trust.
    return (
      target.host === host &&
      target.origin === `${protocol}//${host}` &&
      source.origin === origin &&
      source.origin === target.origin
    );
  } catch {
    return false;
  }
}
