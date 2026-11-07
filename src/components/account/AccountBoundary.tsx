"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { accountSync, watchAccountAuth } from "@/store/account";
import { useAccountState, useSaveStatus, useWorkspaceStore } from "@/store/workspace";

const REFRESH_MS = 30_000;

/**
 * Decides whose farm a screen shows before it renders. A signed-in owner gets their farm from
 * Supabase; everyone else gets the browser demo, unchanged. If the farm can't be loaded the owner
 * sees that, never the demo in its place.
 */
export function AccountBoundary({ area, children }: { area: "app" | "start"; children: ReactNode }) {
  const { m, href } = useI18n();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const status = useAccountState((state) => state.status);
  const active = useAccountState((state) => state.active);
  const notice = useAccountState((state) => state.notice);
  const saveFailed = useSaveStatus((state) => state.status === "failed");
  const setupComplete = useWorkspaceStore((state) => state.workspace?.setupComplete);

  const ready = status === "ready" && active;
  const target = !ready
    ? null
    : area === "start"
      ? setupComplete ? "/app" : null
      : !setupComplete ? "/start" : pathname.endsWith("/app/lab") ? "/app" : null;

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_NAQAH_ACCOUNT_DATA !== "1") return;
    const stop = watchAccountAuth();
    void accountSync.open();
    return stop;
  }, []);

  useEffect(() => {
    if (target) router.replace(href(target));
  }, [href, router, target]);

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
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
        <CamelMark className="h-12 w-auto" />
        <p role="alert" className="max-w-sm text-espresso">{m.account.loadFailed}</p>
        <Button onClick={() => void accountSync.open()}>{m.account.retry}</Button>
      </div>
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
