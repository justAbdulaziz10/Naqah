import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";

/** The old first-visit page. The landing page now carries its one action. */
export default async function Welcome({ params }: PageProps<"/[locale]/welcome">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  redirect(`/${locale}`);
}
