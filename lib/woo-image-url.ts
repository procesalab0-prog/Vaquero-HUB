// Only verified commercial uploads may be used as external catalog covers.
export function wooImageUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "vaquerosm.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname.startsWith("/wp-content/uploads/")
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
