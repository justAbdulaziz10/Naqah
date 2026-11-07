import type { Metadata, Viewport } from "next";
import { Alexandria, Montserrat } from "next/font/google";
import { notFound } from "next/navigation";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { I18nProvider } from "@/i18n/client";
import { dirOf, isLocale, LOCALES } from "@/i18n/config";
import "../globals.css";

const alexandria = Alexandria({ variable: "--font-alexandria", subsets: ["arabic", "latin"], display: "swap" });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], display: "swap" });

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

const META = {
  ar: {
    title: "ناقة | اطمئنان، دون انشغال",
    description: "مساعد صوتي لإدارة عزب الإبل: ناقة تتصل على العامل في وقتك، تسأل وتحفظ، وتصلك الخلاصة باتصال.",
  },
  en: {
    title: "NAQAH | Peace of mind, without the busyness",
    description:
      "An AI voice agent for private camel ranches. NAQAH calls your worker at your set time, asks and records, and you get the essentials in a call.",
  },
} as const;

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const m = META[isLocale(locale) ? locale : "ar"];
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: { default: m.title, template: `%s | ${isLocale(locale) && locale === "en" ? "NAQAH" : "ناقة"}` },
    description: m.description,
    alternates: { languages: { ar: "/ar", en: "/en" } },
    openGraph: { title: m.title, description: m.description, type: "website", locale: locale === "en" ? "en_US" : "ar_SA" },
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
      className={`${alexandria.variable} ${montserrat.variable} antialiased`}
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
