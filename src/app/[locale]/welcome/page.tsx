import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { noindexMetadata } from "../metadata";

/** The old first-visit page. The landing page now carries its one action. */
export async function generateMetadata({ params }: PageProps<"/[locale]/welcome">): Promise<Metadata> {
  const { locale } = await params;
  return noindexMetadata(isLocale(locale) ? locale : "ar", "welcome");
}

export default async function Welcome({ params }: PageProps<"/[locale]/welcome">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  redirect(`/${locale}`);
}
