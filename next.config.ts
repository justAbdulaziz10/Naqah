import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
