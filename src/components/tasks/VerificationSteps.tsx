"use client";

import { Check } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { TaskTicket, Workspace } from "@/domain";
import { upcomingReportCall } from "@/domain/schedule";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/components/visuals/duration";

type StepState = "done" | "waiting" | "passed";

interface Step {
  key: string;
  label: ReactNode;
  state: StepState;
  at: string | null;
  detail: ReactNode;
  spoken: string;
}

const dateTime = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true } as const;

/**
 * The one timeline of a task: asked → reminded → confirmed, top to bottom, with the time of each
 * moment beside it. Same language as every timeline: a filled mark happened, a ring is still to come.
 * "Now" is a hairline between what happened and what is still ahead, never a handle on a track.
 * A task is confirmed only when the worker said so explicitly, so the last mark fills only on a closed ticket.
 */
export function VerificationSteps({ ws, ticket, worker, now, className }: { ws: Workspace; ticket: TaskTicket; worker: string; now: Date; className?: string }) {
  const { m, fmt, locale } = useI18n();
  const s = m.app.tasks2;
  const v = m.visual.tasks;
  const remindedAt = ws.pendingWorkerCalls
    .filter((call) => call.taskTicketId === ticket.id)
    .flatMap((call) => call.attempts.filter((attempt) => attempt.answered).map((attempt) => attempt.at))
    .sort()
    .at(-1) ?? null;
  const closed = ticket.status === "closed";
  const stamp = (iso: string) => <time className="ltr-nums" dateTime={iso}>{fmt.dateTime(iso, dateTime)}</time>;

  // What the last mark waits for: the check call, or the next report call that carries the question.
  const nextCall = !closed && !ticket.scheduledFor ? upcomingReportCall(ws, now) : null;
  const expected = ticket.scheduledFor ?? nextCall?.toISOString() ?? null;
  const passed = !closed && ticket.scheduledFor !== null && now.getTime() > Date.parse(ticket.scheduledFor);
  const took = closed && ticket.closedAt ? formatDuration(Date.parse(ticket.closedAt) - Date.parse(ticket.createdAt), locale) : null;

  const confirmedDetail: ReactNode = closed && ticket.closedAt
    ? <>{stamp(ticket.closedAt)}{took ? <span className="text-muted"> · {v.done(took)}</span> : null}</>
    : passed && ticket.scheduledFor
      ? <>{v.checkPassed} · {stamp(ticket.scheduledFor)}</>
      : ticket.scheduledFor
        ? <>{v.check} {stamp(ticket.scheduledFor)} · {fmt.relative(ticket.scheduledFor, now)}</>
        : nextCall
          ? <>{v.nextCall} {stamp(nextCall.toISOString())} · {v.asksWorker(worker)}</>
          : m.app.tickets.anyTime(worker);

  const steps: Step[] = [
    { key: "asked", label: s.asked, state: "done", at: ticket.createdAt, detail: stamp(ticket.createdAt), spoken: fmt.dateTime(ticket.createdAt, dateTime) },
    {
      key: "reminded",
      label: s.reminded,
      state: remindedAt || closed ? "done" : "waiting",
      at: remindedAt,
      detail: remindedAt ? stamp(remindedAt) : closed ? s.done : s.notYet,
      spoken: remindedAt ? fmt.dateTime(remindedAt, dateTime) : closed ? s.done : s.notYet,
    },
    {
      key: "confirmed",
      label: closed ? s.confirmed : <span className="naqah-name">{m.app.overview.waitingFor(worker)}</span>,
      state: closed ? "done" : passed ? "passed" : "waiting",
      at: ticket.closedAt,
      detail: confirmedDetail,
      spoken: closed && ticket.closedAt ? fmt.dateTime(ticket.closedAt, dateTime) : expected ? `${s.notYet} · ${fmt.dateTime(expected, dateTime)}` : s.notYet,
    },
  ];
  const firstWaiting = steps.findIndex((step) => step.state !== "done");

  return (
    <ol className={cn("relative min-w-0", className)} aria-label={s.stepsLabel(steps[0].spoken, steps[1].spoken, steps[2].spoken)}>
      {steps.map((step, index) => {
        const done = step.state === "done";
        const last = index === steps.length - 1;
        // "Now" sits on the rail between the last thing that happened and the first still ahead.
        const marksNow = firstWaiting > 0 && index === firstWaiting - 1;
        return (
          <li key={step.key} className={cn("relative flex items-start gap-3 last:pb-0", marksNow ? "pb-8" : "pb-3")}>
            {/* The rail between marks: solid where it happened, dashed ahead. */}
            {!last ? (
              <span aria-hidden className={cn("absolute top-5 bottom-0 start-[7px] w-px", done && steps[index + 1].state === "done" ? "bg-brown" : "border-s border-dashed border-faint")} />
            ) : null}
            {/* Now: a short gold tick across the spine (the header strip's mark) with the word beside it, no rule across the row. */}
            {marksNow ? (
              <span aria-hidden className="absolute bottom-2 start-0 flex items-center gap-2">
                <span className="h-[3px] w-4 rounded-full bg-gold" />
                <span className="text-[0.6875rem] font-semibold leading-none text-muted">{m.visual.now}</span>
              </span>
            ) : null}
            <span
              aria-hidden
              className={cn(
                "relative mt-1 flex size-4 shrink-0 items-center justify-center rounded-full",
                done ? "bg-brown text-cream" : step.state === "passed" ? "border-2 border-warn" : "border-[1.5px] border-faint bg-cream",
              )}
            >
              {done ? <Check size={10} weight="bold" /> : null}
            </span>
            <div className="min-w-0 flex-1 text-sm leading-snug">
              <span className={cn("font-semibold", done ? "text-espresso" : step.state === "passed" ? "text-warn" : "text-brown")}>{step.label}</span>
              <span className={cn("ms-2 text-[0.8125rem]", step.state === "passed" ? "text-warn" : "text-muted")}>{step.detail}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
