"use client";

import { ArrowRight, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { EmptyState, noAnswerAttemptInfo } from "@/components/dashboard/DashboardPrimitives";
import { useHashTarget } from "@/components/dashboard/useHashTarget";
import { TaskCalendarLink } from "@/components/integrations/TaskCalendarLink";
import { upcomingReportCall } from "@/components/schedule/ReportCallSection";
import { AttemptDots } from "@/components/visuals/AttemptDots";
import { formatDuration } from "@/components/visuals/duration";
import { TimeRail } from "@/components/visuals/TimeRail";
import { Badge, ButtonLink, Card, Segmented } from "@/components/ui";
import { openNoAnswerTickets, openTaskTickets } from "@/domain";
import type { CallKind, TaskTicket, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useIsAccount, useNow, useWorkspace } from "@/store/workspace";

type TicketTab = "active" | "history";

const dateTime = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true } as const;
// Rail ends: the day and time lead, the date sits underneath, so a phone never wraps mid-time.
const dayTime = { weekday: "short", day: undefined, month: undefined } as const;
const dayMonth = { weekday: undefined, hour: undefined, minute: undefined } as const;

function callKindLabel(kind: CallKind, m: ReturnType<typeof useI18n>["m"]) {
  const labels: Record<CallKind, string> = {
    worker_report: m.app.calls.workerReport,
    worker_report_rejected: m.app.calls.rejectedReport,
    worker_report_missed: m.app.calls.missedReport,
    worker_callback: m.app.calls.workerCallback,
    worker_instruction: m.app.calls.instructionDelivery,
    worker_task_verification: m.app.calls.taskVerification,
    owner_notification: m.app.calls.ownerBriefing,
    owner_inquiry: m.app.calls.ownerInquiry,
    owner_inquiry_rejected: m.app.calls.inquiryDeclined,
  };
  return labels[kind];
}

function TicketGroup({ id, title, footer, children }: { id: string; title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="px-5 py-5 sm:px-8 sm:py-6">
      <h2 id={id} className="text-lg font-semibold leading-snug text-espresso">{title}</h2>
      <ul className="mt-2 divide-y divide-stone/70">{children}</ul>
      {footer}
    </section>
  );
}

/**
 * When a task was given and where it stands against its time: the check call ahead (or passed), the
 * next report call for "any time" tasks, or how long the worker took to confirm a closed one.
 */
function TaskTiming({ ws, ticket, worker, now, className }: { ws: Workspace; ticket: TaskTicket; worker: string; now: Date; className?: string }) {
  const { m, fmt, locale } = useI18n();
  const v = m.visual.tasks;
  const stamp = (iso: string) => <time className="ltr-nums" dateTime={iso}>{fmt.dateTime(iso, dayTime)}</time>;
  const start = { at: ticket.createdAt, label: v.given, value: fmt.relative(ticket.createdAt, now), detail: <time className="ltr-nums" dateTime={ticket.createdAt}>{fmt.dateTime(ticket.createdAt, dateTime)}</time> };
  if (ticket.status === "closed" && ticket.closedAt) {
    const took = formatDuration(Date.parse(ticket.closedAt) - Date.parse(ticket.createdAt), locale);
    return (
      <TimeRail
        compact
        className={className}
        label={v.timing(fmt.dateTime(ticket.createdAt, dateTime), v.done(took))}
        start={{ ...start, value: stamp(ticket.createdAt), detail: fmt.dateTime(ticket.createdAt, dayMonth) }}
        end={{ at: ticket.closedAt, label: m.app.tickets.closedAt, value: stamp(ticket.closedAt), detail: <>{fmt.dateTime(ticket.closedAt, dayMonth)} · {v.done(took)}</> }}
      />
    );
  }
  if (ticket.scheduledFor) {
    const passed = now.getTime() > Date.parse(ticket.scheduledFor);
    const when = fmt.dateTime(ticket.scheduledFor, dateTime);
    return (
      <TimeRail
        compact
        now={now}
        className={className}
        endTone="border-warn"
        label={v.timing(fmt.relative(ticket.createdAt, now), `${passed ? v.checkPassed : v.check}: ${when}`)}
        start={start}
        end={{
          at: ticket.scheduledFor,
          label: passed ? <span className="font-semibold text-warn">{v.checkPassed}</span> : v.check,
          value: stamp(ticket.scheduledFor),
          detail: passed ? m.app.tickets.closeRule : <>{fmt.dateTime(ticket.scheduledFor, dayMonth)} · {fmt.relative(ticket.scheduledFor, now)}</>,
        }}
      />
    );
  }
  const next = upcomingReportCall(ws, now);
  if (!next) return <p className={cn("text-sm text-muted", className)}>{m.app.tickets.anyTime(worker)} · {m.app.tickets.created(fmt.relative(ticket.createdAt, now))}</p>;
  return (
    <TimeRail
      compact
      now={now}
      className={className}
      label={v.timing(fmt.relative(ticket.createdAt, now), `${v.nextCall}: ${fmt.dateTime(next, dateTime)}. ${v.asksWorker(worker)}`)}
      start={start}
      end={{ at: next, label: v.nextCall, value: stamp(next.toISOString()), detail: v.asksWorker(worker) }}
    />
  );
}

export default function TicketsPage() {
  const { m, fmt, href } = useI18n();
  const ws = useWorkspace();
  const account = useIsAccount();
  const now = useNow();
  const [tab, setTab] = useState<TicketTab>("active");
  const linkedTaskId = useHashTarget("task-", Boolean(ws));
  if (!ws) return null;

  const ultimate = ws.settings.plan === "ultimate";
  const active = tab === "active";
  const worker = ws.settings.worker.name.trim() || m.app.overview.unnamedWorker;
  const closedTasks = ws.taskTickets.filter((ticket) => ticket.status === "closed");
  const openTasks = openTaskTickets(ws);
  const openNoAnswers = openNoAnswerTickets(ws);
  const recentlyClosed = ultimate ? [...closedTasks].sort((a, b) => Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? "")).slice(0, 3) : [];
  const tasks = ultimate ? (active ? openTasks : closedTasks) : [];
  const noAnswers = active ? openNoAnswers : ws.noAnswerTickets.filter((ticket) => ticket.status === "closed");
  const relays = ws.relays.filter((relay) => relay.delivered !== active);
  const hasVisibleItems = tasks.length + noAnswers.length + relays.length + (active ? recentlyClosed.length : 0) > 0;
  const hasAnything = (ultimate ? ws.taskTickets.length : 0) + ws.noAnswerTickets.length + ws.relays.length > 0;

  return (
    <div className="max-w-3xl space-y-4 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-bold text-espresso sm:text-[1.8rem]">{m.app.tickets.title}</h1>
        {hasAnything ? <Segmented
          value={tab}
          onChange={setTab}
          label={m.app.tickets.tabsLabel}
          className="w-full justify-between [&>button]:min-h-11 sm:w-auto sm:justify-start"
          options={[
            { value: "active", label: m.app.tickets.active },
            { value: "history", label: m.app.tickets.history },
          ]}
        /> : null}
      </header>

      {!ultimate ? (
        <p className="text-sm leading-relaxed text-muted">
          {m.app.tickets.basicNote}{" "}
          <Link href={`${href("/app/settings")}#settings-plan`} className="inline-flex min-h-11 items-center font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
            {m.app.tickets.planLink}
          </Link>
        </p>
      ) : null}

      <Card className="min-w-0 divide-y divide-stone/70">
          {tasks.length ? (
            <TicketGroup
              id="tickets-tasks"
              title={active ? m.app.tickets.taskTickets : m.app.tickets.closedTaskTickets}
              footer={active ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-stone/70 pt-3 text-sm text-muted">
                  <span>{m.app.tickets.closeRule}</span>
                  {!account ? (
                    <Link href={href("/app/lab")} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
                      {m.app.tickets.verifyNow}
                      <ArrowRight size={15} className="shrink-0 rtl:-scale-x-100" aria-hidden />
                    </Link>
                  ) : null}
                </div>
              ) : undefined}
            >
              {tasks.map((ticket) => (
                <li
                  key={ticket.id}
                  data-hash-target={`task-${ticket.id}`}
                  tabIndex={-1}
                  className={cn("py-4 last:pb-0 focus:outline-none", linkedTaskId === ticket.id && "border-s-2 border-s-brown ps-3")}
                >
                  <p className="text-lg font-semibold leading-relaxed text-espresso">{ticket.instruction}</p>
                  <TaskTiming ws={ws} ticket={ticket} worker={worker} now={now} className="mt-3 max-w-xl" />
                  {active && ticket.status === "open" && ticket.scheduledFor ? <TaskCalendarLink ticket={ticket} /> : null}
                  {!active && ticket.closedVia ? (
                    <p className="mt-2 text-[0.8125rem] text-muted">{m.app.tickets.closedVia(callKindLabel(ticket.closedVia, m))}</p>
                  ) : null}
                </li>
              ))}
            </TicketGroup>
          ) : null}

          {active && recentlyClosed.length ? (
            <TicketGroup id="tickets-recent" title={m.app.tickets.recentlyClosed}>
              {recentlyClosed.map((ticket) => (
                <li key={ticket.id} className="py-4 last:pb-0">
                  <p className="font-medium leading-relaxed text-espresso">{ticket.instruction}</p>
                  <TaskTiming ws={ws} ticket={ticket} worker={worker} now={now} className="mt-3 max-w-xl" />
                </li>
              ))}
            </TicketGroup>
          ) : null}

          {noAnswers.length ? (
            <TicketGroup id="tickets-no-answer" title={m.app.tickets.noAnswerTickets}>
              {noAnswers.map((ticket) => {
                const info = noAnswerAttemptInfo(ws, ticket);
                return (
                  <li key={ticket.id} className="flex items-start gap-3 py-4 last:pb-0">
                    {active ? <WarningCircle size={19} weight="fill" className="mt-1 shrink-0 text-danger" aria-hidden /> : null}
                    <div className="min-w-0">
                      <p className="text-lg font-semibold leading-relaxed text-espresso">{ticket.message}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <AttemptDots count={info.count} label={m.visual.tasks.attempts(fmt.number(info.count))} />
                        <span className={cn("text-sm font-semibold", active ? "text-danger" : "text-muted")}>{m.app.tickets.attempts(fmt.number(info.count))}</span>
                        {active ? <span className="text-sm text-muted">{m.app.tickets.lastAttempt} <time className="ltr-nums" dateTime={info.lastAttemptAt}>{fmt.dateTime(info.lastAttemptAt, { hour: "numeric", minute: "2-digit", hour12: true })}</time></span> : null}
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {active
                          ? m.app.tickets.callbackRule
                          : ticket.closedAt
                            ? <>{m.app.tickets.closedAt} <time className="ltr-nums" dateTime={ticket.closedAt}>{fmt.dateTime(ticket.closedAt, dateTime)}</time></>
                            : m.app.tickets.closedByCallback}
                      </p>
                    </div>
                  </li>
                );
              })}
            </TicketGroup>
          ) : null}

          {relays.length ? (
            <TicketGroup id="tickets-relays" title={m.app.tickets.relays}>
              {relays.map((relay) => (
                <li key={relay.id} className="py-4 last:pb-0">
                  <p className="text-lg font-semibold leading-relaxed text-espresso">{relay.message}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={relay.delivered ? "ok" : "warn"} dot>{relay.delivered ? m.app.tickets.delivered : m.app.tickets.notDelivered}</Badge>
                    <span className="text-[0.8125rem] text-muted">{m.app.tickets.relayedAt(fmt.relative(relay.at, now))}</span>
                  </div>
                </li>
              ))}
            </TicketGroup>
          ) : null}

          {!hasVisibleItems ? (
            <EmptyState
              title={active ? m.app.tickets.emptyActive : m.app.tickets.emptyHistory}
              body={active && ultimate ? m.app.tickets.emptyActiveBody : undefined}
              action={active && !account ? <ButtonLink href={href("/app/lab")} variant="secondary">{m.app.overview.simulateCall}</ButtonLink> : undefined}
            />
          ) : null}
        </Card>
    </div>
  );
}
