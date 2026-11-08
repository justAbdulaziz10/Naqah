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
 * One report's path, left to right in reading order: the worker, NAQAH, then the owner. A filled dot
 * happened, an outlined one has not, an amber outline was missed. The line into a step is solid only
 * once that step has happened.
 */
export function ReportFlow({ steps, label, className }: { steps: FlowStep[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn("grid min-w-0", className)} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, index) => {
        const next = steps[index + 1];
        return (
          <li key={step.key} className="relative min-w-0 pe-3">
            {next ? (
              <span
                aria-hidden
                className={cn("absolute end-0 start-4 top-[5px] border-t-2", next.state === "done" ? "naqah-draw border-brown" : "border-dashed border-brown/40")}
              />
            ) : null}
            <span aria-hidden className={cn("relative block size-3 rounded-full", dot[step.state])} />
            <p className={cn("mt-2 text-sm font-semibold leading-snug", step.state === "missed" ? "text-warn" : "text-espresso")}>{step.title}</p>
            {step.detail ? <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">{step.detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
