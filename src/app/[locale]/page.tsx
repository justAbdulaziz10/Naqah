import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NightLanding } from "@/components/landing/night/NightLanding";
import { isLocale } from "@/i18n/config";
import { localizedAlternates } from "./metadata";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: localizedAlternates(isLocale(locale) ? locale : "ar", "/") };
}

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <NightLanding locale={locale} />;
}
