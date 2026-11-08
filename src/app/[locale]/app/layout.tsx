import { AccountBoundary } from "@/components/account/AccountBoundary";
import { AppShell } from "@/components/shell/AppShell";

export default function AppLayout({ children }: LayoutProps<"/[locale]/app">) {
  return (
    <AccountBoundary area="app">
      <AppShell>{children}</AppShell>
    </AccountBoundary>
  );
}
