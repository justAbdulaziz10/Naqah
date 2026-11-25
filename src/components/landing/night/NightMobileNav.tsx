"use client";

import { List } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold-bright)]";

/** The phone menu on the night ground: same behaviour as the light site's, dressed in the night tokens. */
export function NightMobileNav({
  links,
  menuLabel,
  menuTitle,
  authControls,
  actions,
}: {
  links: { href: string; label: string }[];
  menuLabel: string;
  menuTitle: string;
  authControls?: ReactNode;
  /** The primary entry actions, shown in the menu where the header has no room for them. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center lg:hidden">
      <details
        className="group relative"
        onKeyDown={(event) => {
          const details = event.currentTarget;
          if (event.key !== "Escape" || !details.open) return;
          details.removeAttribute("open");
          details.querySelector("summary")?.focus();
        }}
      >
        <summary
          aria-label={menuLabel}
          className={`inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--line-strong)] text-[var(--text)] transition-colors hover:bg-[var(--glass-strong)] group-open:bg-[var(--glass-strong)] ${focusRing} [&::-webkit-details-marker]:hidden`}
        >
          <List size={20} weight="regular" aria-hidden="true" />
        </summary>
        <nav
          aria-label={menuTitle}
          className="absolute end-0 top-[calc(100%+0.75rem)] z-50 grid w-[min(20rem,calc(100vw-2.5rem))] gap-1 rounded-2xl border border-[var(--line-strong)] bg-[var(--night-2)] p-3 text-start text-[var(--text)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
              className={`flex min-h-11 items-center rounded-xl px-3.5 text-base font-semibold text-[var(--text)] transition-colors hover:bg-[var(--glass-strong)] ${focusRing}`}
            >
              {link.label}
            </a>
          ))}
          {authControls}
          {actions ? <div className="mt-1 grid gap-2 border-t border-[var(--line)] pt-3 sm:hidden">{actions}</div> : null}
          <div className="mt-1 border-t border-[var(--line)] pt-2">
            <LocaleSwitcher className="min-h-11 w-full justify-start rounded-xl px-3.5" tone="light" />
          </div>
        </nav>
      </details>
    </div>
  );
}
