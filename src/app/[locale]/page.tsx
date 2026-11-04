import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";

/** Placeholder — owned by the landing slice. */
export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <h1 className="p-8 text-3xl font-bold">{locale === "ar" ? "ناقة" : "NAQAH"}</h1>;
}
