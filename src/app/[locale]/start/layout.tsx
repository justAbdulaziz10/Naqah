import type { Metadata } from "next";
import { AccountBoundary } from "@/components/account/AccountBoundary";
import { isLocale } from "@/i18n/config";
import { noindexMetadata } from "../metadata";

export async function generateMetadata({ params }: LayoutProps<"/[locale]/start">): Promise<Metadata> {
  const { locale } = await params;
  return noindexMetadata(isLocale(locale) ? locale : "ar", "start");
}

export default function StartLayout({ children }: LayoutProps<"/[locale]/start">) {
  return <AccountBoundary area="start">{children}</AccountBoundary>;
}
