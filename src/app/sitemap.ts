import type { MetadataRoute } from "next";
import type { Locale } from "@/domain/types";
import { resolveMetadataBase } from "./[locale]/metadata";

const PUBLIC_LOCALES: readonly Locale[] = ["ar", "en"];

function localizedHome(locale: Locale): string {
  return `/${locale}`;
}

export function buildSitemap(siteBase: URL): MetadataRoute.Sitemap {
  const languageHomes = Object.fromEntries(
    PUBLIC_LOCALES.map((locale) => [locale, new URL(localizedHome(locale), siteBase).toString()]),
  );

  return PUBLIC_LOCALES.map((locale) => ({
    url: languageHomes[locale],
    alternates: { languages: languageHomes },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap(resolveMetadataBase());
}
