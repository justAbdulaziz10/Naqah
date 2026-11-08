import { cn } from "@/lib/cn";

/** Unanswered calls to the worker, one outlined mark each, joined in the order they were placed. */
export function AttemptDots({ count, label, className }: { count: number; label: string; className?: string }) {
  return (
    <span role="img" aria-label={label} className={cn("inline-flex items-center", className)}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="inline-flex items-center">
          {index ? <span aria-hidden className="h-0 w-3 border-t-2 border-dashed border-warn/50" /> : null}
          <span aria-hidden className="size-3 rounded-full border-2 border-warn bg-cream" />
        </span>
      ))}
    </span>
  );
}
