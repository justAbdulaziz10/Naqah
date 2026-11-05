"use client";

/**
 * Owner dashboard shell: sidebar on desktop, bottom tab bar on mobile,
 * top bar with farm name, plan, demo clock and language switch.
 * Also gates every /app page: no workspace → friendly start screen.
 */
import {
  ClipboardText,
  GearSix,
  House,
  PhoneList,
  Waveform,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { Logo } from "@/components/brand/Logo";
import { Button, ButtonLink } from "@/components/ui";
import { openNoAnswerTickets, openTaskTickets } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow, useWorkspaceStore } from "@/store/workspace";
import { LocaleSwitcher } from "./LocaleSwitcher";

type NavKey = "overview" | "herd" | "lab" | "tickets" | "calls" | "settings";

const NAV: { key: NavKey; path: string; icon: Icon | "camel" }[] = [
  { key: "overview", path: "/app", icon: House },
  { key: "herd", path: "/app/herd", icon: "camel" },
  { key: "lab", path: "/app/lab", icon: Waveform },
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
          <Button onClick={() => startDemo(locale)} size="lg">
            {m.common.actions.startDemo}
          </Button>
          <ButtonLink href={href("/start")} variant="secondary" size="lg">
            {m.common.actions.setUp}
          </ButtonLink>
        </div>
        <LocaleSwitcher />
      </div>
    );
  }

  const openTasks = openTaskTickets(ws).length + openNoAnswerTickets(ws).length;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-stone/70 bg-cream/60 px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo locale={locale} href={href("/")} />
        </div>
        <nav aria-label={m.common.nav.overview} className="mt-10 flex flex-col gap-1">
          {NAV.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.key}
                href={href(item.path)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-semibold transition",
                  active ? "bg-espresso/[0.07] text-espresso" : "text-muted hover:bg-espresso/5 hover:text-espresso",
                )}
              >
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
        <div className="mt-auto space-y-3 px-2">
          <div className="border-t border-stone/70 pt-4">
            <p className="truncate text-sm font-semibold">{ws.settings.owner.name}</p>
            <p className="mt-0.5 text-xs text-faint">{m.common.demo.badge}</p>
          </div>
          <LocaleSwitcher className="-ms-2.5" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-stone/60 bg-ivory/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden">
              <Logo locale={locale} href={href("/")} />
            </div>
            <div className="hidden min-w-0 items-center gap-3 lg:flex">
              <h1 className="truncate text-lg font-bold">{ws.settings.farm.name}</h1>
              <span className="text-sm text-muted">{m.common.plans[ws.settings.plan]}</span>
            </div>
            <div className="ms-auto flex items-center gap-1">
              <DemoClock />
              <div className="lg:hidden">
                <LocaleSwitcher className="px-2.5" />
              </div>
              <Link
                href={href("/app/settings")}
                aria-label={m.common.nav.settings}
                className="inline-flex size-10 items-center justify-center rounded-full hover:bg-espresso/5 lg:hidden"
              >
                <GearSix size={22} aria-hidden />
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
      </div>

      {/* Bottom tabs (mobile) */}
      <nav
        aria-label={m.common.nav.overview}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-stone/70 bg-cream/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.filter((n) => n.key !== "settings").map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.key}
                href={href(item.path)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold transition",
                  active ? "text-espresso" : "text-muted",
                )}
              >
                <NavIcon icon={item.icon} active={active} />
                <span className="max-w-full truncate px-1">{m.common.nav[item.key]}</span>
                {item.key === "tickets" && openTasks > 0 ? (
                  <span className="absolute top-2 start-1/2 ms-2.5 min-w-4 rounded-full bg-brown px-1 text-center text-[0.65rem] leading-4 text-cream">
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
