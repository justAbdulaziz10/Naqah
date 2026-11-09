import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { I18nProvider } from "@/i18n/client";
import { getMessages } from "@/i18n/messages";
import { dirOf, isLocale, LOCALES } from "@/i18n/config";
import { resolveMetadataBase } from "./metadata";
import "../globals.css";

const alexandriaArabic = localFont({
  src: "../fonts/alexandria-arabic-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "alexandriaArabic" },
    {
      prop: "unicode-range",
      value:
        "U+000D, U+0020, U+0041, U+00A0, U+00C1, U+060C, U+0615, U+061B, U+061F, U+0621-063A, U+0640-0656, U+0658, U+0660-0671, U+0679, U+067E, U+0686, U+0688, U+0691, U+0698, U+06A1, U+06A4, U+06A9, U+06AF, U+06BA, U+06BE, U+06C1-06C3, U+06CC, U+06D2-06D4, U+06F0-06F9, U+2010, U+FB51, U+FB57-FB59, U+FB67-FB69, U+FB6B-FB6D, U+FB7B-FB7D, U+FB89, U+FB8B, U+FB8D, U+FB8F-FB91, U+FB93-FB95, U+FB9F, U+FBA7-FBA9, U+FBAB-FBAD, U+FBAF, U+FBB1-FBB9, U+FBBD-FBBE, U+FBFD-FBFF, U+FC64-FC65, U+FC67, U+FC6A-FC6B, U+FC6D, U+FC70-FC71, U+FC73, U+FC76-FC77, U+FC79, U+FC8A-FC8B, U+FC8D, U+FC91-FC92, U+FC94, U+FD0D-FD10, U+FD29-FD2C, U+FD3E-FD3F, U+FDF2, U+FE82, U+FE84, U+FE86, U+FE88, U+FE8A-FE8C, U+FE8E, U+FE90-FE92, U+FE94, U+FE96-FE98, U+FE9A-FE9C, U+FE9E-FEA0, U+FEA2-FEA4, U+FEA6-FEA8, U+FEAA, U+FEAC, U+FEAE, U+FEB0, U+FEB2-FEB4, U+FEB6-FEB8, U+FEBA-FEBC, U+FEBE-FEC0, U+FEC2-FEC4, U+FEC6-FEC8, U+FECA-FECC, U+FECE-FED0, U+FED2-FED4, U+FED6-FED8, U+FEDA-FEDC, U+FEDE-FEE0, U+FEE2-FEE4, U+FEE6-FEE8, U+FEEA-FEEC, U+FEEE, U+FEF0, U+FEF2-FEFC",
    },
  ],
});
const alexandriaLatin = localFont({
  src: "../fonts/alexandria-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "alexandriaLatin" },
    {
      prop: "unicode-range",
      value:
        "U+000D, U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+2009, U+200B, U+2013-2014, U+2018-201A, U+201C-201E, U+2022, U+2026, U+2032-2033, U+2039-203A, U+2044, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215",
    },
  ],
});
const alexandriaLatinExt = localFont({
  src: "../fonts/alexandria-latin-ext-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "alexandriaLatinExt" },
    {
      prop: "unicode-range",
      value:
        "U+000D, U+0020, U+0041, U+00A0, U+00C1, U+0100-0130, U+0132-0151, U+0154-017E, U+018F, U+0192, U+01A0-01A1, U+01AF-01B0, U+01C4-01CC, U+01E6-01E7, U+01EA-01EB, U+01FA-021B, U+022A-022D, U+0230-0233, U+0237, U+0259, U+02BC, U+02BE-02BF, U+02C7-02CC, U+02DD, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+1E08-1E09, U+1E0C-1E0F, U+1E14-1E17, U+1E1C-1E1D, U+1E20-1E21, U+1E24-1E25, U+1E2A-1E2B, U+1E2E-1E2F, U+1E36-1E37, U+1E3A-1E3B, U+1E42-1E49, U+1E4C-1E53, U+1E5A-1E5B, U+1E5E-1E69, U+1E6C-1E6F, U+1E78-1E7B, U+1E80-1E85, U+1E8E-1E8F, U+1E92-1E93, U+1E97, U+1E9E, U+1EF2-1EF9, U+2020, U+20A1, U+20A3-20A4, U+20A6-20A7, U+20A9, U+20AB, U+20AD, U+20B1-20B2, U+20B5, U+20B9-20BA, U+20BC-20BD, U+2113, U+A78B-A78C",
    },
  ],
});
const montserratLatin = localFont({
  src: "../fonts/montserrat-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "montserratLatin" },
    {
      prop: "unicode-range",
      value:
        "U+0000, U+000D, U+0020-007E, U+00A0-00AC, U+00AE-00FF, U+0102, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+2009, U+200B, U+2013-2014, U+2018-201A, U+201C-201E, U+2022, U+2026, U+2032-2033, U+2039-203A, U+2044, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215",
    },
  ],
});
const montserratLatinExt = localFont({
  src: "../fonts/montserrat-latin-ext-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "montserratLatinExt" },
    {
      prop: "unicode-range",
      value:
        "U+0000, U+000D, U+0020, U+0041, U+00A0, U+00C1, U+0100-0130, U+0132-0151, U+0154-0183, U+0186-018C, U+018E-0194, U+0196-01A1, U+01A4-01A6, U+01A9, U+01AC-01B9, U+01C0-01F5, U+01F8-0220, U+0222-0223, U+0226-0233, U+0237, U+023A-023E, U+0241-0251, U+0253-0254, U+0256-0259, U+025B-025C, U+025F-0260, U+0263-0266, U+0268-026C, U+026F, U+0271-0272, U+0274-0275, U+027D-027E, U+0280, U+0283, U+0287-028C, U+028E, U+0292, U+0294-0295, U+0298, U+029D, U+02B0, U+02B7-02BA, U+02BC-02C1, U+02C7-02CC, U+02D7, U+02DD, U+02EC, U+02EE, U+02FB-02FC, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1D3A, U+1D43, U+1D49, U+1D4B, U+1D52-1D53, U+1D58, U+1D5B, U+1D7B, U+1D7D-1D7E, U+1D91, U+1DA4, U+1DB6, U+1DBB, U+1DBF, U+1E00-1E9B, U+1E9E, U+1EF2-1EF9, U+2020, U+20A1, U+20A3-20A4, U+20A6-20A7, U+20A9, U+20AB, U+20AD-20AE, U+20B1-20B2, U+20B4-20B5, U+20B8-20BA, U+20BC-20BD, U+20BF, U+2113, U+2C60-2C66, U+2C6D-2C6F, U+2C72-2C73, U+A726-A727, U+A740-A741, U+A789-A78D, U+A792-A793, U+A7A8-A7AB, U+A7AD-A7AE, U+A7B1-A7B9, U+A7C7-A7C8, U+A7CB-A7CD, U+A7DA-A7DC",
    },
  ],
});
const fontVariables = {
  "--font-alexandria": [
    alexandriaArabic.style.fontFamily,
    alexandriaLatin.style.fontFamily,
    alexandriaLatinExt.style.fontFamily,
  ].join(", "),
  "--font-montserrat": [montserratLatin.style.fontFamily, montserratLatinExt.style.fontFamily].join(", "),
} as CSSProperties;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : "ar";
  const metadata = getMessages(lang).landing.metadata;
  return {
    metadataBase: resolveMetadataBase(),
    title: { default: metadata.title, template: `%s | ${lang === "en" ? "NAQAH" : "ناقة"}` },
    description: metadata.description,
    openGraph: { title: metadata.title, description: metadata.description, type: "website", locale: lang === "en" ? "en_US" : "ar_SA" },
    appleWebApp: { capable: true, title: "NAQAH", statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: "#29241f",
  width: "device-width",
  initialScale: 1,
};

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    // suppressHydrationWarning: browser extensions may add attributes to <html> before hydration.
    <html
      lang={locale}
      dir={dirOf(locale)}
      className="antialiased"
      style={fontVariables}
      suppressHydrationWarning
    >
      <body>
        <I18nProvider locale={locale}>
          <ServiceWorkerRegistrar />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
