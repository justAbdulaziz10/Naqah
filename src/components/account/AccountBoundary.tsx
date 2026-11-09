"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { ACCOUNT_DATA } from "@/components/entry/paths";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { planSelectionGatePath, planSelectionResumePath } from "@/lib/account/plan-selection-paths";
import { safeReturnPath } from "@/lib/supabase/auth-input";
import { accountSync, watchAccountAuth } from "@/store/account";
import { useAccountState, useSaveStatus, useWorkspaceStore } from "@/store/workspace";

const REFRESH_MS = 30_000;

/**
 * Decides whose farm a screen shows before it renders. A signed-in owner gets their farm from
 * Supabase; everyone else gets the browser demo, unchanged. If the farm can't be loaded the owner
 * sees that, never the demo in its place.
 */
export function AccountBoundary({ area, children }: { area: "app" | "start"; children: ReactNode }) {
  const { locale, m, href } = useI18n();
  const router = useRouter();
  const status = useAccountState((state) => state.status);
  const active = useAccountState((state) => state.active);
  const notice = useAccountState((state) => state.notice);
  const saveFailed = useSaveStatus((state) => state.status === "failed");
  const setupComplete = useWorkspaceStore((state) => state.workspace?.setupComplete);
  const hydrated = useWorkspaceStore((state) => state.hydrated);

  const ready = status === "ready" && active;
  // Where accounts exist, a visitor without a session doesn't get a browser-only "farm" that looks
  // real: setup needs an account, and /app is the demo only once the demo has been opened.
  const visitorTarget = ACCOUNT_DATA && status === "demo" && hydrated
    ? area === "start" ? `/signup?next=${encodeURIComponent(href("/start"))}` : !setupComplete ? "/login" : null
    : null;
  const target = status === "planRequired"
    ? "/choose-plan"
    : !ready
    ? visitorTarget
    : area === "start"
      ? setupComplete ? "/app" : null
      : !setupComplete ? "/start" : null; // LabPage sends account owners away unless the server allows test calls.

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_NAQAH_ACCOUNT_DATA !== "1") return;
    const stop = watchAccountAuth();
    void accountSync.open();
    return stop;
  }, []);

  useEffect(() => {
    if (status === "planRequired") {
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      router.replace(planSelectionGatePath(locale, current));
    } else if (target && area === "start" && ready && setupComplete) {
      const returnTo = safeReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
      router.replace(planSelectionResumePath(locale, true, returnTo ?? href("/app")));
    } else if (target) router.replace(href(target));
  }, [area, href, locale, ready, router, setupComplete, status, target]);

  useEffect(() => {
    if (status === "signedOut") router.replace(href("/login"));
  }, [href, router, status]);

  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void accountSync.refresh();
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (accountSync.hasUnsaved()) event.preventDefault();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("beforeunload", warn);
    };
  }, [active]);

  if (status === "error") {
    // Never the demo in its place: a calm page that keeps every way out (retry, language, home, sign out).
    return (
      <main className="flex min-h-dvh flex-col px-6 py-6">
        <div className="flex items-center justify-between">
          <Link href={href("/")} className="inline-flex min-h-11 items-center" aria-label={m.common.loadError.home}>
            <CamelMark className="h-8 w-auto" />
          </Link>
          <LocaleSwitcher />
        </div>
        <section aria-labelledby="load-error" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
          <h1 id="load-error" className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-espresso">{m.common.loadError.title}</h1>
          <p role="alert" className="mt-3 text-lg leading-relaxed text-muted">{m.account.loadFailed}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => void accountSync.open()}>{m.account.retry}</Button>
            <Link href={href("/")} className="inline-flex min-h-11 items-center px-2 font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
              {m.common.loadError.home}
            </Link>
          </div>
          <div className="mt-10 border-t border-stone/70 pt-6">
            <p className="mb-3 text-sm text-muted">{m.common.loadError.orSignOut}</p>
            <LogoutButton />
          </div>
        </section>
      </main>
    );
  }
  if (status === "checking" || status === "signedOut" || target) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label={m.account.loading}>
        <CamelMark className="h-10 w-auto animate-pulse opacity-60" />
      </div>
    );
  }
  return (
    <>
      {active && (saveFailed || notice) ? (
        <div role="alert" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 border-b border-danger bg-cream px-4 py-2 text-sm text-danger">
          <span>{notice === "refused" ? m.account.refused : saveFailed ? m.account.notSaved : m.account.planLocked}</span>
          {saveFailed && notice !== "refused" ? (
            <button type="button" className="min-h-11 font-semibold underline underline-offset-4" onClick={() => void accountSync.flush()}>
              {m.account.retry}
            </button>
          ) : (
            <button type="button" className="min-h-11 font-semibold underline underline-offset-4" onClick={() => useAccountState.setState({ notice: null })} hidden={notice === "refused"}>
              {m.account.dismiss}
            </button>
          )}
        </div>
      ) : null}
      {children}
    </>
  );
}
