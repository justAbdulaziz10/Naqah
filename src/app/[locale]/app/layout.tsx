import type { Metadata } from "next";
import { AccountBoundary } from "@/components/account/AccountBoundary";
import { AppShell } from "@/components/shell/AppShell";
import { isLocale } from "@/i18n/config";
import { noindexMetadata } from "../metadata";

export async function generateMetadata({ params }: LayoutProps<"/[locale]/app">): Promise<Metadata> {
  const { locale } = await params;
  return noindexMetadata(isLocale(locale) ? locale : "ar", "app");
}

export default function AppLayout({ children }: LayoutProps<"/[locale]/app">) {
  return (
    <AccountBoundary area="app">
      <AppShell>{children}</AppShell>
    </AccountBoundary>
  );
}
