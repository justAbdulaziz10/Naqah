import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { localizedAlternates, noindexMetadata, resolveMetadataBase } from "./[locale]/metadata";
import { config as proxyConfig } from "../proxy";
import { buildRobots } from "./robots";
import { buildSitemap } from "./sitemap";

describe("metadata base URL", () => {
  it("uses the configured public URL in production", () => {
    expect(
      resolveMetadataBase({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://naqah.example/" }).toString(),
    ).toBe("https://naqah.example/");
  });

  it("uses Vercel's production hostname when the public URL is not set", () => {
    expect(
      resolveMetadataBase({ NODE_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "naqah.vercel.app" }).toString(),
    ).toBe("https://naqah.vercel.app/");
  });

  it("fails clearly when a production URL is unavailable", () => {
    expect(() => resolveMetadataBase({ VERCEL_ENV: "production" })).toThrow(
      "Missing NEXT_PUBLIC_SITE_URL for production metadata",
    );
  });

  it("uses localhost only outside production", () => {
    expect(resolveMetadataBase({ NODE_ENV: "development" }).toString()).toBe("http://localhost:3000/");
  });

  it("rejects malformed configured URLs", () => {
    expect(() => resolveMetadataBase({ NEXT_PUBLIC_SITE_URL: "naqah.example" })).toThrow(
      "NEXT_PUBLIC_SITE_URL must be an absolute http(s) URL",
    );
  });
});

describe("localized metadata", () => {
  it("keeps canonical and language alternates on the same normalized route", () => {
    expect(localizedAlternates("en", "/app/herd/?tab=camels#list")).toEqual({
      canonical: "/en/app/herd",
      languages: { ar: "/ar/app/herd", en: "/en/app/herd" },
    });
  });

  it("marks app, setup and welcome metadata noindex and nofollow in both locales", () => {
    for (const page of ["app", "start", "welcome"] as const) {
      for (const locale of ["ar", "en"] as const) {
        const metadata = noindexMetadata(locale, page);
        expect(metadata.title).toBeTruthy();
        expect(metadata.robots).toEqual({ index: false, follow: false });
      }
      expect(noindexMetadata("ar", page).title).not.toBe(noindexMetadata("en", page).title);
    }
  });
});

describe("robots and sitemap routes", () => {
  const siteBase = new URL("https://naqah.example");

  it("allows public pages and excludes private localized and API routes", () => {
    expect(buildRobots(siteBase)).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/*/app", "/*/start", "/*/login", "/*/signup", "/*/choose-plan", "/*/welcome", "/api"],
      },
      sitemap: "https://naqah.example/sitemap.xml",
    });
  });

  it("lists only the public Arabic and English home pages with matching language alternates", () => {
    expect(buildSitemap(siteBase)).toEqual([
      {
        url: "https://naqah.example/ar",
        alternates: {
          languages: { ar: "https://naqah.example/ar", en: "https://naqah.example/en" },
        },
      },
      {
        url: "https://naqah.example/en",
        alternates: {
          languages: { ar: "https://naqah.example/ar", en: "https://naqah.example/en" },
        },
      },
    ]);
  });

  it("keeps metadata files outside the locale redirect matcher", () => {
    expect(unstable_doesMiddlewareMatch({ config: proxyConfig, url: "/robots.txt" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config: proxyConfig, url: "/sitemap.xml" })).toBe(false);
  });
});
