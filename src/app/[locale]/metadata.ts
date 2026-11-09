import type { Metadata } from "next";
import type { Locale } from "@/domain/types";
import { getMessages } from "@/i18n/messages";

export type MetadataEnvironment = {
  NEXT_PUBLIC_SITE_URL?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

export function resolveMetadataBase(env: MetadataEnvironment = process.env): URL {
  const configuredUrl = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredUrl) return parseMetadataUrl(configuredUrl, "NEXT_PUBLIC_SITE_URL");

  const isProduction = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
  if (!isProduction) return new URL("http://localhost:3000");

  const vercelProjectUrl = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProjectUrl) {
    const normalizedUrl = /^https?:\/\//i.test(vercelProjectUrl) ? vercelProjectUrl : `https://${vercelProjectUrl}`;
    return parseMetadataUrl(normalizedUrl, "VERCEL_PROJECT_PRODUCTION_URL");
  }

  throw new Error(
    "Missing NEXT_PUBLIC_SITE_URL for production metadata. Set it or provide VERCEL_PROJECT_PRODUCTION_URL.",
  );
}

function parseMetadataUrl(value: string, envName: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return url;
  } catch {
    throw new Error(`${envName} must be an absolute http(s) URL for metadata.`);
  }
}

function localizedPath(locale: Locale, pathname: string): string {
  const pathWithoutQuery = pathname.split(/[?#]/, 1)[0] ?? "";
  const path = pathWithoutQuery.split("/").filter(Boolean).join("/");
  return `/${locale}${path ? `/${path}` : ""}`;
}

export function localizedAlternates(locale: Locale, pathname: string): NonNullable<Metadata["alternates"]> {
  return {
    canonical: localizedPath(locale, pathname),
    languages: {
      ar: localizedPath("ar", pathname),
      en: localizedPath("en", pathname),
    },
  };
}

export type PrivateMetadataPage = "app" | "start" | "welcome";

export function noindexMetadata(locale: Locale, page: PrivateMetadataPage): Metadata {
  const copy = getMessages(locale).landing.metadata;
  const pageCopy = {
    app: { title: copy.appTitle, description: copy.appDescription },
    start: { title: copy.startTitle, description: copy.startDescription },
    welcome: { title: copy.welcomeTitle, description: copy.welcomeDescription },
  }[page];

  return {
    ...pageCopy,
    robots: { index: false, follow: false },
  };
}
