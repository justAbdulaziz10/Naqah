import { AccountBoundary } from "@/components/account/AccountBoundary";

export default function StartLayout({ children }: LayoutProps<"/[locale]/start">) {
  return <AccountBoundary area="start">{children}</AccountBoundary>;
}
