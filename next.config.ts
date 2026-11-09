import type { NextConfig } from "next";

function cspConnectSources(): string[] {
  const sources = [
    "'self'",
    "https://api.open-meteo.com",
    "https://api.openai.com",
    "wss://api.openai.com",
    "stun:",
    "turn:",
  ];
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") {
        sources.push(url.origin);
        sources.push(`${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
      }
    } catch {
      // Ignore invalid configuration; Supabase setup validates this value at its own boundary.
    }
  }
  return [...new Set(sources)];
}

function securityHeaders(): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), geolocation=(self), microphone=(self)" },
    {
      key: "Content-Security-Policy-Report-Only",
      value: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src ${cspConnectSources().join(" ")}`,
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
      ].join("; "),
    },
  ];
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
  }
  return headers;
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
  experimental: {
    // The owner dashboard (/app) and onboarding (/start) read the workspace from localStorage and render
    // after hydration, so implicit instant-navigation validation can't see their pages (dev-only warning).
    // Validate only segments that explicitly export `instant`.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
