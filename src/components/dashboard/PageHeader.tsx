import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The same opening for Herd, Tasks and Calls: one title, one short line under it, and the page's
 * one control at the end edge (on phones, under the title at full width).
 */
export function PageHeader({ title, lead, answer, children, action, className }: {
  title: string;
  /** A quiet note under the title (a principle, a hint). */
  lead?: ReactNode;
  /** The page's one-sentence answer ("Wadha needs attention; 7 are well"): the same weight on every page. */
  answer?: ReactNode;
  /** Anything that belongs with the title, e.g. the herd count. */
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8", className)}>
      <div className="min-w-0">
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-espresso sm:text-[2.5rem]">{title}</h1>
        {answer ? <p className="mt-2 max-w-2xl text-lg font-medium leading-relaxed text-espresso sm:text-xl">{answer}</p> : null}
        {lead ? <p className={cn("max-w-2xl text-muted", answer ? "mt-1 text-sm" : "mt-1")}>{lead}</p> : null}
        {children}
      </div>
      {action ? <div className="min-w-0 shrink-0">{action}</div> : null}
    </header>
  );
}

/** A label over a group of rows: what the group is and, quietly, how many. */
export function GroupLabel({ id, children, count }: { id?: string; children: ReactNode; count?: string }) {
  return (
    <h2 id={id} className="mb-3 flex items-baseline gap-2 text-[0.9375rem] font-semibold text-espresso">
      {children}
      {count ? <span className="ltr-nums text-sm font-medium text-muted">{count}</span> : null}
    </h2>
  );
}
