"use client";

import { ArrowLeft, ArrowRight, CircleNotch } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useWorkspaceStore } from "@/store/workspace";

/** Browser-only flag: the visitor has already moved on from Welcome into setup. */
const SEEN_KEY = "naqah-welcome-seen";
const CHANGE_EVENT = "naqah-welcome-seen-change";

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function markWelcomeSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage unavailable: Welcome may show again, which is harmless.
  }
}

/**
 * Where "set up your farm" should go. First-time visitors see Welcome once; anyone who has already
 * moved on from it, or has a setup in progress, goes straight to onboarding. There is no login yet,
 * so this is a per-browser courtesy, not an account state.
 */
export function useSetupHref(): string {
  const { href } = useI18n();
  const seen = useSyncExternalStore(subscribe, readSeen, () => false);
  const setupInProgress = useWorkspaceStore((state) => Boolean(state.workspace && !state.workspace.setupComplete));
  return href(seen || setupInProgress ? "/start" : "/welcome");
}

/** A link into setup that respects useSetupHref. */
export function SetupLink({ className, children }: { className?: string; children: ReactNode }) {
  const target = useSetupHref();
  return (
    <Link href={target} className={className}>
      {children}
    </Link>
  );
}

/**
 * The one primary action on Welcome. Navigation starts on the first frame; the reading pane fades
 * for about 300ms meanwhile (handoff §04: never delay the form for the motion).
 */
export function WelcomeStart({ label, pending: pendingLabel }: { label: string; pending: string }) {
  const { href, locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;

  useEffect(() => () => document.documentElement.removeAttribute("data-welcome-leaving"), []);

  function start() {
    if (pending) return;
    markWelcomeSeen();
    document.documentElement.setAttribute("data-welcome-leaving", "");
    startTransition(() => router.push(href("/start")));
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "group inline-flex min-h-14 w-full items-center justify-center gap-3 bg-espresso px-8 text-lg font-semibold text-cream",
        "transition-[background-color,transform] duration-200 hover:bg-brown active:scale-[0.98] disabled:opacity-80",
        "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-espresso",
      )}
    >
      {pending ? <CircleNotch size={20} className="motion-safe:animate-spin" aria-hidden="true" /> : null}
      {pending ? pendingLabel : label}
      {pending ? null : (
        <Arrow
          size={20}
          weight="regular"
          aria-hidden="true"
          className="transition-transform duration-200 group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
        />
      )}
    </button>
  );
}
