"use client";

import { Check } from "@phosphor-icons/react";
import type { TaskTicket, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

type StepState = "done" | "waiting";

/**
 * Where a task stands with the worker, in three marks: asked → reminded → confirmed.
 * Same language as every timeline: a filled mark happened, a ring is still to come. A task is
 * confirmed only when the worker said so explicitly, so the last mark fills only on a closed ticket.
 */
export function VerificationSteps({ ws, ticket, className }: { ws: Workspace; ticket: TaskTicket; className?: string }) {
  const { m, fmt } = useI18n();
  const s = m.app.tasks2;
  const remindedAt = ws.pendingWorkerCalls
    .filter((call) => call.taskTicketId === ticket.id)
    .flatMap((call) => call.attempts.filter((attempt) => attempt.answered).map((attempt) => attempt.at))
    .sort()
    .at(-1) ?? null;
  const closed = ticket.status === "closed";
  const steps: { key: string; label: string; state: StepState; at: string | null }[] = [
    { key: "asked", label: s.asked, state: "done", at: ticket.createdAt },
    { key: "reminded", label: s.reminded, state: remindedAt || closed ? "done" : "waiting", at: remindedAt },
    { key: "confirmed", label: s.confirmed, state: closed ? "done" : "waiting", at: ticket.closedAt },
  ];
  const time = (iso: string) => fmt.dateTime(iso, { weekday: undefined, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  const spoken = (step: (typeof steps)[number]) => (step.state === "done" ? (step.at ? time(step.at) : s.done) : s.notYet);

  return (
    <div className={cn("flex items-center gap-1", className)} role="img" aria-label={s.stepsLabel(spoken(steps[0]), spoken(steps[1]), spoken(steps[2]))}>
      {steps.map((step, index) => (
        <div key={step.key} className="flex min-w-0 items-center gap-1">
          {index > 0 ? <span aria-hidden className={cn("h-px w-4 shrink-0 sm:w-6", step.state === "done" ? "bg-brown" : "border-t border-dashed border-faint")} /> : null}
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full",
                step.state === "done" ? "bg-brown text-cream" : "border-[1.5px] border-faint",
              )}
            >
              {step.state === "done" ? <Check size={10} weight="bold" /> : null}
            </span>
            <span className={cn("whitespace-nowrap text-[0.8125rem]", step.state === "done" ? "font-semibold text-espresso" : "text-muted")}>{step.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
