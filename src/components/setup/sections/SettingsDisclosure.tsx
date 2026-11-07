"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * One secondary Settings row: its title and a one-line summary, with the controls behind it.
 * Rows sit inside one hairline surface (the group), so a row never draws its own card.
 * A link to `#id` opens the row and brings it into view.
 */
export function SettingsDisclosure({
  id,
  title,
  summary,
  status,
  children,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  /** The save state, shown beside the title while the row is open. */
  status?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const openFromHash = () => {
      const details = ref.current;
      if (!details || window.location.hash !== `#${id}`) return;
      details.open = true;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // After the page settles (sticky offsets are measured on mount), so the title lands below the nav.
      timer = window.setTimeout(() => details.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" }), 200);
    };
    let timer = 0;
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [id]);

  return (
    <details ref={ref} id={id} className="group scroll-mt-[var(--settings-offset,9rem)]">
      <summary
        className={cn(
          "flex min-h-16 cursor-pointer list-none items-center gap-4 px-5 py-3.5 sm:px-6 [&::-webkit-details-marker]:hidden",
          "transition-colors hover:bg-ivory/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brown",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-semibold text-espresso">{title}</span>
            <span className="hidden group-open:inline">{status}</span>
          </span>
          {summary ? <span className="mt-0.5 block truncate text-sm text-muted">{summary}</span> : null}
        </span>
        <CaretDown size={18} className="shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="px-5 pb-6 pt-1 sm:px-6">{children}</div>
    </details>
  );
}
