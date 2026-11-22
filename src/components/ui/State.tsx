import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Designed states from the brief: an empty state is one sentence and one action; an error state
 * names the plain cause and offers a retry. Neither is a card: both sit flat on the page or inside
 * the section they describe, so they never nest inside another card.
 */
export function EmptyState({
  title,
  body,
  action,
  visual,
  className,
  compact,
}: {
  title: ReactNode;
  /** One sentence at most. */
  body?: ReactNode;
  /** One action, usually a Button or ButtonLink. */
  action?: ReactNode;
  /** A small data visual or the CamelMark; never a decorative icon tile. */
  visual?: ReactNode;
  className?: string;
  /** Tighter padding when it sits inside a section rather than as the page's answer. */
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "gap-3 py-8" : "gap-4 py-14", className)}>
      {visual ? <div className="text-faint">{visual}</div> : null}
      <div className="max-w-md">
        <p className="naqah-heading text-espresso">{title}</p>
        {body ? <p className="naqah-meta mt-1.5">{body}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  action,
  className,
  compact,
}: {
  title: ReactNode;
  /** The plain cause. */
  body?: ReactNode;
  /** The retry, or the way back. */
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center text-center", compact ? "gap-3 py-8" : "gap-4 py-14", className)}>
      <WarningCircle size={28} weight="regular" className="text-danger" aria-hidden />
      <div className="max-w-md">
        <p className="naqah-heading text-espresso">{title}</p>
        {body ? <p className="naqah-meta mt-1.5">{body}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
