import type { MetadataRoute } from "next";
import { resolveMetadataBase } from "./[locale]/metadata";

export function buildRobots(siteBase: URL): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/*/app", "/*/start", "/*/login", "/*/signup", "/*/choose-plan", "/*/welcome", "/api"],
    },
    sitemap: new URL("/sitemap.xml", siteBase).toString(),
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots(resolveMetadataBase());
}
