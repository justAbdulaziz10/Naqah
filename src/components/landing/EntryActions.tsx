"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useNavigationIdentity } from "@/components/auth/AuthNavigationClient";
import type { NavigationIdentity } from "@/components/auth/navigation-state";
import { ACCOUNT_DATA, getStartedPath } from "@/components/entry/paths";
import { buttonClass, type ButtonStyleProps } from "@/components/ui/Button";
import { useI18n } from "@/i18n/client";
import { DemoAction } from "./LandingActions";

/**
 * The landing's one primary action. A signed-in owner opens their dashboard; everyone else sets up
 * their ranch, with the demo as a quieter second choice. The demo is never offered to a signed-in owner.
 */
export function EntryActionsClient({
  initialIdentity,
  primary,
  demoClassName,
  arrow,
}: {
  initialIdentity: NavigationIdentity;
  primary: ButtonStyleProps;
  /** Omit to show only the primary action (e.g. in the header). */
  demoClassName?: string;
  arrow?: ReactNode;
}) {
  const { m, href, locale } = useI18n();
  const router = useRouter();
  const identity = useNavigationIdentity(initialIdentity);
  // Set-up is prefetched on intent, not on sight, so it never competes with the landing's first paint.
  const start = getStartedPath(locale);
  const intent = { prefetch: false, onPointerEnter: () => router.prefetch(start), onFocus: () => router.prefetch(start), onTouchStart: () => router.prefetch(start) } as const;
  if (ACCOUNT_DATA && identity.status === "signedIn") {
    return (
      <Link href={href("/app")} className={buttonClass(primary)}>
        {m.common.actions.openDashboard}
        {arrow}
      </Link>
    );
  }
  return (
    <>
      <Link href={start} className={buttonClass(primary)} {...intent}>
        {m.landing.setUp}
        {arrow}
      </Link>
      {demoClassName ? (
        <DemoAction plain className={demoClassName}>{m.common.actions.startDemo}</DemoAction>
      ) : null}
    </>
  );
}
