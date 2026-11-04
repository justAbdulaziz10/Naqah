import { AppShell } from "@/components/shell/AppShell";

export default function AppLayout({ children }: LayoutProps<"/[locale]/app">) {
  return <AppShell>{children}</AppShell>;
}
