import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type FlowState = "done" | "waiting" | "missed";

export interface FlowStep {
  key: string;
  title: ReactNode;
  detail?: ReactNode;
  state: FlowState;
}

const dot: Record<FlowState, string> = {
  done: "bg-brown",
  waiting: "border-2 border-brown bg-cream",
  missed: "border-2 border-warn bg-cream",
};

/**
 * One report's path in reading order: the worker, NAQAH, the owner (and the worker again when the
 * owner sent an instruction). A filled dot happened, an outlined one has not, an amber outline was
 * missed. The line into a step is solid only once that step has happened. Down the page on phones
 * when `stack` is set, across it from `sm`.
 */
export function ReportFlow({ steps, label, stack = false, className }: { steps: FlowStep[]; label: string; stack?: boolean; className?: string }) {
  return (
    <ol
      aria-label={label}
      className={cn("min-w-0", stack ? "flex flex-col sm:grid" : "grid", className)}
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((step, index) => {
        const next = steps[index + 1];
        return (
          <li key={step.key} className={cn("relative min-w-0", stack ? "ps-6 pb-4 last:pb-0 sm:ps-0 sm:pb-0 sm:pe-3" : "pe-3")}>
            {next ? (
              <span
                aria-hidden
                className={cn(
                  "absolute",
                  stack
                    ? "bottom-0 start-[5px] top-4 border-s-2 sm:bottom-auto sm:end-0 sm:start-4 sm:top-[5px] sm:border-s-0 sm:border-t-2"
                    : "end-0 start-4 top-[5px] border-t-2",
                  next.state === "done" ? "naqah-draw border-brown" : "border-dashed border-brown/40",
                )}
              />
            ) : null}
            <span aria-hidden className={cn("block size-3 rounded-full", stack ? "absolute start-0 top-1 sm:relative sm:top-0" : "relative", dot[step.state])} />
            <p className={cn("text-sm font-semibold leading-snug", stack ? "sm:mt-2" : "mt-2", step.state === "missed" ? "text-warn" : "text-espresso")}>{step.title}</p>
            {step.detail ? <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">{step.detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
