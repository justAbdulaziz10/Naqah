"use client";

/**
 * Owner dashboard shell: sidebar on desktop, bottom tab bar on mobile,
 * top bar with farm name, plan, demo clock and language switch.
 * Also gates every /app page: no workspace → friendly start screen.
 */
import {
  ArrowRight,
  ClipboardText,
  Flask,
  GearSix,
  House,
  Microphone,
  PhoneList,
  Waveform,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { EventNotifier } from "@/components/pwa/EventNotifier";
import { Logo } from "@/components/brand/Logo";
import { hasOwnSetupData } from "@/components/setup/draft";
import { Button, ButtonLink, ConfirmDialog, Toaster } from "@/components/ui";
import { openNoAnswerTickets, openTaskTickets } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useIsAccount, useNow, useWorkspaceStore } from "@/store/workspace";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { getStartedPath } from "@/components/entry/paths";

/** Only hides the link. The route itself checks the session and the owner allowlist. */
const VOICE_LAB = process.env.NEXT_PUBLIC_NAQAH_VOICE_LAB === "1";

type NavKey = "overview" | "herd" | "tickets" | "calls" | "settings";

/** The owner's places. The Call Lab is a demo tool, so it lives with the demo controls, not here. */
const NAV: { key: NavKey; path: string; icon: Icon | "camel" }[] = [
  { key: "overview", path: "/app", icon: House },
  { key: "herd", path: "/app/herd", icon: "camel" },
  { key: "tickets", path: "/app/tickets", icon: ClipboardText },
  { key: "calls", path: "/app/calls", icon: PhoneList },
  { key: "settings", path: "/app/settings", icon: GearSix },
];

function NavIcon({ icon, active, size = 22 }: { icon: Icon | "camel"; active: boolean; size?: number }) {
  if (icon === "camel") return <CamelMark className={cn("h-[18px] w-auto", active ? "text-current" : "text-current opacity-90")} />;
  const I = icon;
  return <I size={size} weight={active ? "fill" : "regular"} aria-hidden />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { m, href, locale } = useI18n();
  const pathname = usePathname() ?? "";
  const hydrated = useWorkspaceStore((s) => s.hydrated);
  const ws = useWorkspaceStore((s) => s.workspace);
  const startDemo = useWorkspaceStore((s) => s.startDemo);
  const account = useIsAccount();
  // The Voice Lab needs a signed-in owner, so demo visitors are not shown a door they can't open.
  const voiceLab = VOICE_LAB && account;
  const nav = NAV;
  const [confirmingDemo, setConfirmingDemo] = useState(false);

  const isActive = (path: string) => {
    const full = href(path);
    return path === "/app" ? pathname === full : pathname.startsWith(full);
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <CamelMark className="h-10 w-auto animate-pulse opacity-60" />
      </div>
    );
  }

  if (!ws || !ws.setupComplete) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
        <CamelMark className="h-16 w-auto" />
        <div className="max-w-md">
          <h1 className="text-2xl font-bold">{m.common.demo.noWorkspace}</h1>
          <p className="mt-2 text-muted">{m.common.demo.noWorkspaceBody}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => (hasOwnSetupData(ws) ? setConfirmingDemo(true) : startDemo(locale))} size="lg">
            {m.common.actions.startDemo}
          </Button>
          <ButtonLink href={getStartedPath(locale)} variant="secondary" size="lg">
            {m.common.actions.getStarted}
          </ButtonLink>
        </div>
        <LocaleSwitcher />
        {confirmingDemo ? (
          <ConfirmDialog
            title={m.common.demo.sampleConfirmTitle}
            body={m.common.demo.sampleConfirmSetup}
            confirmLabel={m.common.demo.sampleConfirmAction}
            cancelLabel={m.common.demo.sampleConfirmCancel}
            onConfirm={() => {
              setConfirmingDemo(false);
              startDemo(locale);
            }}
            onCancel={() => setConfirmingDemo(false)}
          />
        ) : null}
      </div>
    );
  }

  const openTasks = (ws.settings.plan === "ultimate" ? openTaskTickets(ws).length : 0) + openNoAnswerTickets(ws).length;

  return (
    <div className="naqah-app min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <a
        href="#main"
        className="fixed start-4 top-3 z-[60] -translate-y-24 rounded-full bg-espresso px-5 py-3 text-sm font-semibold text-cream shadow-lift transition-transform focus-visible:translate-y-0"
      >
        {m.common.nav.skip}
      </a>
      <EventNotifier />
      <Toaster />
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-stone/70 bg-cream/60 px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo locale={locale} href={href("/")} />
          <p className="mt-5 truncate font-semibold text-espresso">{ws.settings.farm.name.trim() || m.app.overview.estateFallback}</p>
          <Link href={`${href("/app/settings")}#settings-plan`} className="-mx-1 inline-flex min-h-11 items-center rounded-lg px-1 text-sm text-muted underline-offset-4 hover:text-espresso hover:underline">
            {m.common.plans[ws.settings.plan]}
          </Link>
        </div>
        <nav aria-label={m.common.nav.main} className="mt-6 flex flex-col gap-1">
          {nav.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.key}
                href={href(item.path)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-semibold transition-colors duration-200 active:scale-[0.99]",
                  active ? "bg-espresso/[0.07] text-espresso" : "text-muted hover:bg-espresso/5 hover:text-espresso",
                )}
              >
                <span aria-hidden className={cn("absolute inset-y-2.5 start-0 w-[3px] rounded-full bg-brown transition-[opacity,transform] duration-300", active ? "opacity-100" : "scale-y-0 opacity-0")} />
                <span className="flex w-6 justify-center">
                  <NavIcon icon={item.icon} active={active} />
                </span>
                <span className="flex-1">{m.common.nav[item.key]}</span>
                {item.key === "tickets" && openTasks > 0 ? (
                  <span className="ltr-nums text-xs font-semibold tabular-nums text-brown">
                    {openTasks}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        {account ? null : (
          <div className="mt-6 border-t border-stone/70 pt-4">
            <p className="px-3 text-xs font-semibold text-muted">{m.common.demo.label}</p>
            <Link
              href={href("/app/lab")}
              aria-current={isActive("/app/lab") ? "page" : undefined}
              className={cn(
                "relative mt-1 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-200",
                isActive("/app/lab") ? "bg-espresso/[0.07] text-espresso" : "text-muted hover:bg-espresso/5 hover:text-espresso",
              )}
            >
              <span className="flex w-6 justify-center"><Waveform size={22} weight={isActive("/app/lab") ? "fill" : "regular"} aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-[0.95rem] font-semibold">{m.common.nav.lab}</span>
                <span className="block text-xs text-muted">{m.common.demo.labHint}</span>
              </span>
            </Link>
          </div>
        )}
        {voiceLab ? (
          <Link
            href={href("/app/voice-lab")}
            aria-current={isActive("/app/voice-lab") ? "page" : undefined}
            className={cn(
              "mt-2 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-[0.95rem] font-semibold transition-colors duration-200",
              isActive("/app/voice-lab") ? "bg-espresso/[0.07] text-espresso" : "text-muted hover:bg-espresso/5 hover:text-espresso",
            )}
          >
            <span className="flex w-6 justify-center"><Microphone size={22} weight={isActive("/app/voice-lab") ? "fill" : "regular"} aria-hidden /></span>
            {m.voiceLab.nav}
          </Link>
        ) : null}
        <div className="mt-auto space-y-3 px-2">
          <div className="border-t border-stone/70 pt-4">
            {ws.settings.owner.name.trim() ? <p className="truncate text-sm font-semibold">{ws.settings.owner.name}</p> : null}
            {account ? null : <p className="mt-0.5 text-xs text-muted">{m.common.demo.badge}</p>}
          </div>
          <LocaleSwitcher className="-ms-2.5" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-stone/60 bg-ivory">
          {/* Phones only: on desktop the sidebar names the product and the estate. */}
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:hidden">
            <Logo locale={locale} href={href("/")} className="min-h-11" />
            <div className="ms-auto flex items-center gap-1">
              <LocaleSwitcher />
              {voiceLab ? (
                <Link href={href("/app/voice-lab")} aria-label={m.voiceLab.nav} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-espresso/5">
                  <Microphone size={22} aria-hidden />
                </Link>
              ) : null}
              <Link
                href={href("/app/settings")}
                aria-label={m.common.nav.settings}
                className="inline-flex size-11 items-center justify-center rounded-full hover:bg-espresso/5"
              >
                <GearSix size={22} aria-hidden />
              </Link>
            </div>
          </div>
          {account ? null : <DemoNotice showSimulate={!isActive("/app/lab")} labHref={href("/app/lab")} />}
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 focus:outline-none sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
      </div>

      {/* Bottom tabs (mobile) */}
      <nav
        aria-label={m.common.nav.main}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-stone/70 bg-cream pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {nav.filter((n) => n.key !== "settings").map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.key}
                href={href(item.path)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold transition-colors duration-200 active:scale-95",
                  active ? "text-espresso" : "text-muted",
                )}
              >
                <span aria-hidden className={cn("absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-brown transition-[opacity,transform] duration-300", active ? "opacity-100" : "scale-x-0 opacity-0")} />
                <NavIcon icon={item.icon} active={active} />
                <span className="max-w-full truncate px-1">{m.common.nav[item.key]}</span>
                {item.key === "tickets" && openTasks > 0 ? (
                  <span className="ltr-nums absolute top-2 start-1/2 ms-2.5 min-w-4 rounded-full bg-brown px-1 text-center text-[0.65rem] leading-4 text-cream">
                    {openTasks}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/**
 * Every record in this browser workspace is simulated (sample farm or Call Lab runs); real
 * calls don't reach it yet. Shown on every dashboard page so no one mistakes it for live data.
 */
function DemoNotice({ showSimulate, labHref }: { showSimulate: boolean; labHref: string }) {
  const { m } = useI18n();
  return (
    <div role="note" className="border-t border-stone/60 bg-cream lg:border-t-0">
      <div className="mx-auto flex min-h-11 max-w-6xl items-center gap-2 px-4 text-sm sm:px-6 lg:px-8">
        <Flask size={16} className="shrink-0 text-brown" aria-hidden />
        <span className="shrink-0 font-semibold text-brown">{m.common.demo.label}</span>
        <span aria-hidden className="text-muted">·</span>
        <span className="min-w-0 truncate text-muted sm:hidden">{m.common.demo.badge}</span>
        <span className="hidden min-w-0 truncate text-muted sm:inline xl:hidden">{m.common.demo.noticeShort}</span>
        <span className="hidden min-w-0 truncate text-muted xl:inline">{m.common.demo.notice}</span>
        <div className="ms-auto flex shrink-0 items-center gap-1">
          <div className="max-sm:hidden">
            <DemoClock />
          </div>
          {showSimulate ? (
            <Link href={labHref} className="naqah-nudge inline-flex min-h-11 items-center gap-1 font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
              {m.common.demo.simulateCall}
              <ArrowRight size={14} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Shows the workspace clock (Riyadh) — it can be moved forward in the Call Lab. */
export function DemoClock() {
  const { m, fmt } = useI18n();
  const now = useNow();
  return (
    <div className="px-2" title={m.common.demo.clockHint}>
      <span className="ltr-nums text-sm tabular-nums text-muted">
        <span className="hidden sm:inline">{fmt.dateTime(now, { hour: "numeric", minute: "2-digit", weekday: "short", day: undefined, month: undefined })}</span>
        <span className="sm:hidden">{fmt.time(now)}</span>
      </span>
    </div>
  );
}
