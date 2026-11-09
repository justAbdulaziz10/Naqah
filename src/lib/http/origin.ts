function firstHeaderValue(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

/** Compare the browser Origin with the public origin used by the current request. */
export function hasSameOrigin(request: Request): boolean {
  const rawOrigin = request.headers.get("origin");
  const host = firstHeaderValue(request.headers.get("x-forwarded-host"))
    ?? firstHeaderValue(request.headers.get("host"));
  if (!rawOrigin || !host) return false;

  try {
    const origin = new URL(rawOrigin);
    if ((origin.protocol !== "https:" && origin.protocol !== "http:") || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return false;
    const forwardedProtocol = firstHeaderValue(request.headers.get("x-forwarded-proto"));
    const protocol = forwardedProtocol ? `${forwardedProtocol.toLowerCase()}:` : new URL(request.url).protocol;
    if (protocol !== "https:" && protocol !== "http:") return false;
    const target = new URL(`${protocol}//${host}`);
    return !target.username && !target.password && target.pathname === "/" && !target.search && !target.hash && origin.origin === target.origin;
  } catch {
    return false;
  }
}
