import { cn } from "@/lib/cn";

export type AttemptMark = "answered" | "owner" | "no_answer" | "rejected";

const MARK: Record<AttemptMark, string> = {
  answered: "bg-brown",
  owner: "bg-sand",
  no_answer: "border-2 border-warn bg-cream",
  rejected: "border-2 border-faint bg-cream",
};

/**
 * The attempts of one call, joined in the order they were placed: filled = answered (sand for the
 * owner), amber ring = no answer, grey ring = not accepted. `count` alone draws unanswered attempts.
 */
export function AttemptDots({ count, marks, label, className }: { count?: number; marks?: AttemptMark[]; label: string; className?: string }) {
  const states: AttemptMark[] = marks ?? Array.from({ length: count ?? 0 }, () => "no_answer");
  return (
    <span role="img" aria-label={label} className={cn("inline-flex items-center", className)}>
      {states.map((state, index) => (
        <span key={index} className="inline-flex items-center">
          {index ? <span aria-hidden className={cn("h-0 w-3 border-t-2 border-dashed", state === "no_answer" ? "border-warn/50" : "border-stone")} /> : null}
          <span aria-hidden className={cn("size-3 rounded-full", MARK[state])} />
        </span>
      ))}
    </span>
  );
}
