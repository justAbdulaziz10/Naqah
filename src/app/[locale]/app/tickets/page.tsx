"use client";

import { ArrowRight, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { EmptyState, noAnswerAttemptInfo } from "@/components/dashboard/DashboardPrimitives";
import { useHashTarget } from "@/components/dashboard/useHashTarget";
import { TaskCalendarLink } from "@/components/integrations/TaskCalendarLink";
import { Badge, ButtonLink, Card, Segmented } from "@/components/ui";
import { openNoAnswerTickets, openTaskTickets } from "@/domain";
import type { CallKind } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useIsAccount, useNow, useWorkspace } from "@/store/workspace";

type TicketTab = "active" | "history";

const dateTime = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true } as const;

function callKindLabel(kind: CallKind, m: ReturnType<typeof useI18n>["m"]) {
  const labels: Record<CallKind, string> = {
    worker_report: m.app.calls.workerReport,
    worker_report_rejected: m.app.calls.rejectedReport,
    worker_callback: m.app.calls.workerCallback,
    worker_instruction: m.app.calls.instructionDelivery,
    worker_task_verification: m.app.calls.taskVerification,
    owner_notification: m.app.calls.ownerBriefing,
    owner_inquiry: m.app.calls.ownerInquiry,
    owner_inquiry_rejected: m.app.calls.inquiryDeclined,
  };
  return labels[kind];
}

function TicketGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="px-5 py-5 sm:px-8 sm:py-6">
      <h2 id={id} className="text-lg font-semibold leading-snug text-espresso">{title}</h2>
      <ul className="mt-2 divide-y divide-stone/70">{children}</ul>
    </section>
  );
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex min-h-11 items-baseline justify-between gap-3 border-b border-stone/70 py-2 last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="ltr-nums text-lg font-semibold tabular-nums text-espresso">{value}</span>
    </p>
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

  return (
    <div className="space-y-4 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-bold text-espresso sm:text-[1.8rem]">{m.app.tickets.title}</h1>
        <Segmented
          value={tab}
          onChange={setTab}
          label={m.app.tickets.tabsLabel}
          className="w-full justify-between [&>button]:min-h-11 sm:w-auto sm:justify-start"
          options={[
            { value: "active", label: m.app.tickets.active },
            { value: "history", label: m.app.tickets.history },
          ]}
        />
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <Card className="min-w-0 divide-y divide-stone/70 lg:col-span-8">
          {tasks.length ? (
            <TicketGroup id="tickets-tasks" title={m.app.tickets.taskTickets}>
              {tasks.map((ticket) => (
                <li
                  key={ticket.id}
                  data-hash-target={`task-${ticket.id}`}
                  tabIndex={-1}
                  className={cn("py-4 last:pb-0 focus:outline-none", linkedTaskId === ticket.id && "border-s-2 border-s-brown ps-3")}
                >
                  <p className="text-lg font-semibold leading-relaxed text-espresso">{ticket.instruction}</p>
                  <p className="mt-1 text-sm text-muted">
                    {active
                      ? ticket.scheduledFor
                        ? <>{m.app.tickets.scheduledForPrefix} <time className="ltr-nums" dateTime={ticket.scheduledFor}>{fmt.dateTime(ticket.scheduledFor, dateTime)}</time> {m.app.tickets.scheduledForSuffix(worker)}</>
                        : m.app.tickets.anyTime(worker)
                      : ticket.closedAt
                        ? <>{m.app.tickets.closedAt} <time className="ltr-nums" dateTime={ticket.closedAt}>{fmt.dateTime(ticket.closedAt, dateTime)}</time></>
                        : ""}
                  </p>
                  {active && ticket.status === "open" && ticket.scheduledFor ? <TaskCalendarLink ticket={ticket} /> : null}
                  {active ? (
                    <p className="mt-1 text-[0.8125rem] text-muted">{m.app.tickets.created(fmt.relative(ticket.createdAt, now))}</p>
                  ) : ticket.closedVia ? (
                    <p className="mt-1 text-[0.8125rem] text-muted">{m.app.tickets.closedVia(callKindLabel(ticket.closedVia, m))}</p>
                  ) : null}
                </li>
              ))}
            </TicketGroup>
          ) : null}

          {active && recentlyClosed.length ? (
            <TicketGroup id="tickets-recent" title={m.app.tickets.recentlyClosed}>
              {recentlyClosed.map((ticket) => (
                <li key={ticket.id} className="py-3 last:pb-0">
                  <p className="font-medium leading-relaxed text-espresso">{ticket.instruction}</p>
                  {ticket.closedAt ? <p className="mt-0.5 text-sm text-muted">{m.app.tickets.closedAt} <time className="ltr-nums" dateTime={ticket.closedAt}>{fmt.dateTime(ticket.closedAt, dateTime)}</time></p> : null}
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
                        <Badge tone={active ? "danger" : "neutral"} dot>{m.app.tickets.attempts(fmt.number(info.count))}</Badge>
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

          {!hasVisibleItems ? <EmptyState title={active ? m.app.tickets.emptyActive : m.app.tickets.emptyHistory} /> : null}
        </Card>

        <Card className="min-w-0 px-5 py-5 sm:px-8 sm:py-6 lg:col-span-4 lg:px-6">
          <h2 className="text-lg font-semibold leading-snug text-espresso">{m.app.tickets.summary}</h2>
          <div className="mt-2">
            {ultimate ? <Count label={m.app.tickets.openTasks} value={fmt.number(openTasks.length)} /> : null}
            <Count label={m.app.tickets.unanswered} value={fmt.number(openNoAnswers.length)} />
            <Count label={m.app.tickets.waiting} value={fmt.number(ws.relays.filter((relay) => !relay.delivered).length)} />
            {ultimate ? <Count label={m.app.tickets.closedTasks} value={fmt.number(closedTasks.length)} /> : null}
          </div>
          {ultimate ? (
            <>
              <p className="mt-4 text-sm leading-relaxed text-muted">{m.app.tickets.closeRule}</p>
              {openTasks.length && !account ? (
                <ButtonLink href={href("/app/lab")} variant="secondary" size="sm" className="mt-3 min-h-11 w-full whitespace-normal">
                  {m.app.tickets.verifyNow}
                  <ArrowRight size={16} className="shrink-0 rtl:-scale-x-100" aria-hidden />
                </ButtonLink>
              ) : null}
            </>
          ) : (
            <div className="mt-4">
              <p className="font-semibold text-espresso">{m.app.tickets.basicExplainerTitle}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{m.app.tickets.basicExplainerBody}</p>
              <Link href={`${href("/app/settings")}#settings-plan`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
                {m.app.tickets.comparePlans}
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
