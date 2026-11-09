import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

async function headers() {
  const rules = await nextConfig.headers?.();
  return rules?.find((rule) => rule.source === "/:path*")?.headers ?? [];
}

describe("Next response security headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sets the baseline and report-only policy for every path", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tenant.supabase.co");
    const result = await headers();
    const values = Object.fromEntries(result.map(({ key, value }) => [key, value]));
    expect(values["X-Content-Type-Options"]).toBe("nosniff");
    expect(values["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(values["X-Frame-Options"]).toBe("DENY");
    expect(values["Permissions-Policy"]).toBe("camera=(), geolocation=(self), microphone=(self)");
    expect(values["Strict-Transport-Security"]).toBeUndefined();
    expect(values["Content-Security-Policy-Report-Only"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(values["Content-Security-Policy-Report-Only"]).toContain("style-src 'self' 'unsafe-inline'");
    expect(values["Content-Security-Policy-Report-Only"]).toContain("img-src 'self' data: blob:");
    expect(values["Content-Security-Policy-Report-Only"]).toContain("https://tenant.supabase.co");
    expect(values["Content-Security-Policy-Report-Only"]).toContain("wss://tenant.supabase.co");
    expect(values["Content-Security-Policy-Report-Only"]).toContain("https://api.open-meteo.com");
    expect(values["Content-Security-Policy-Report-Only"]).toContain("https://api.openai.com");
  });

  it("adds HSTS for production deployments", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(Object.fromEntries((await headers()).map(({ key, value }) => [key, value]))["Strict-Transport-Security"])
      .toBe("max-age=63072000; includeSubDomains; preload");
  });
});
