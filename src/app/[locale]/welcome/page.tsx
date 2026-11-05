import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WelcomePage } from "@/components/welcome/WelcomePage";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

export async function generateMetadata({ params }: PageProps<"/[locale]/welcome">): Promise<Metadata> {
  const { locale } = await params;
  return { title: getMessages(isLocale(locale) ? locale : "ar").welcome.metaTitle };
}

export default async function Welcome({ params }: PageProps<"/[locale]/welcome">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <WelcomePage locale={locale} />;
}
