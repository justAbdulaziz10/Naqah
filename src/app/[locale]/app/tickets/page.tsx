"use client";

import { ArrowRight, CheckCircle, ClipboardText, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import Link from "next/link";
import { EmptyState, noAnswerAttemptInfo } from "@/components/dashboard/DashboardPrimitives";
import { useHashTarget } from "@/components/dashboard/useHashTarget";
import { TaskCalendarLink } from "@/components/integrations/TaskCalendarLink";
import { Badge, ButtonLink, Card, CardBody, CardHeader, Segmented } from "@/components/ui";
import { openNoAnswerTickets, openTaskTickets } from "@/domain";
import type { CallKind } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow, useWorkspace } from "@/store/workspace";

type TicketTab = "active" | "history";

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

export default function TicketsPage() {
  const { m, fmt, href } = useI18n();
  const ws = useWorkspace();
  const now = useNow();
  const [tab, setTab] = useState<TicketTab>("active");
  const linkedTaskId = useHashTarget("task-", Boolean(ws));
  if (!ws) return null;

  const active = tab === "active";
  const tasks = ws.settings.plan === "ultimate"
    ? active ? openTaskTickets(ws) : ws.taskTickets.filter((ticket) => ticket.status === "closed")
    : [];
  const noAnswers = active ? openNoAnswerTickets(ws) : ws.noAnswerTickets.filter((ticket) => ticket.status === "closed");
  const relays = ws.relays.filter((relay) => relay.delivered !== active);
  const hasVisibleItems = tasks.length + noAnswers.length + relays.length > 0;

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-espresso sm:text-[1.8rem]">{m.app.tickets.title}</h1>
        </div>
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

      {ws.settings.plan === "basic" ? (
        <Card className="border-info/20">
          <CardHeader title={m.app.tickets.basicExplainerTitle} icon={<ClipboardText size={19} aria-hidden />} />
          <CardBody className="pt-3 text-sm leading-relaxed text-muted">
            <p>{m.app.tickets.basicExplainerBody}</p>
            <Link href={`${href("/app/settings")}#settings-plan`} className="mt-1 inline-flex min-h-11 items-center font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
              {m.app.tickets.comparePlans}
            </Link>
          </CardBody>
        </Card>
      ) : null}

      {tasks.length ? (
        <Card>
          <CardHeader title={m.app.tickets.taskTickets} icon={<ClipboardText size={19} aria-hidden />} />
          <CardBody className="pt-3">
            {active ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-info-soft/70 px-4 py-3">
                <p className="text-sm text-info">{m.app.tickets.closeRule}</p>
                <ButtonLink href={href("/app/lab")} variant="secondary" size="sm" className="min-h-11">
                  {m.app.tickets.verifyNow}
                  <ArrowRight size={16} className="rtl:-scale-x-100" aria-hidden />
                </ButtonLink>
              </div>
            ) : null}
            <ul className="divide-y divide-stone/70">
              {tasks.map((ticket) => (
                <li
                  key={ticket.id}
                  id={`task-${ticket.id}`}
                  tabIndex={-1}
                  className={cn("py-4 first:pt-0 last:pb-0 focus:outline-none", linkedTaskId === ticket.id && "border-s-2 border-s-brown ps-3")}
                >
                  <p className="font-semibold leading-relaxed">{ticket.instruction}</p>
                  <p className="mt-1 text-sm text-muted">
                    {active
                      ? ticket.scheduledFor
                        ? <>{m.app.tickets.scheduledForPrefix} <time className="ltr-nums" dateTime={ticket.scheduledFor}>{fmt.dateTime(ticket.scheduledFor, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</time> {m.app.tickets.scheduledForSuffix(ws.settings.worker.name)}</>
                        : m.app.tickets.anyTime(ws.settings.worker.name.trim() || m.app.overview.unnamedWorker)
                      : ticket.closedAt
                        ? <>{m.app.tickets.closedAt} <time className="ltr-nums" dateTime={ticket.closedAt}>{fmt.dateTime(ticket.closedAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</time></>
                        : ""}
                  </p>
                  {active && ticket.status === "open" && ticket.scheduledFor ? <TaskCalendarLink ticket={ticket} /> : null}
                  {active ? (
                    <p className="mt-1 text-xs text-muted">{m.app.tickets.created(fmt.relative(ticket.createdAt, now))}</p>
                  ) : ticket.closedVia ? (
                    <p className="mt-1 text-xs text-muted">{m.app.tickets.closedVia(callKindLabel(ticket.closedVia, m))}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {noAnswers.length ? (
        <Card>
          <CardHeader title={m.app.tickets.noAnswerTickets} icon={<WarningCircle size={19} weight="fill" className="text-danger" aria-hidden />} />
          <CardBody className="pt-3">
            <ul className="divide-y divide-stone/70">
              {noAnswers.map((ticket) => {
                const info = noAnswerAttemptInfo(ws, ticket);
                return (
                  <li key={ticket.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={active ? "danger" : "neutral"} dot>{m.app.tickets.attempts(fmt.number(info.count))}</Badge>
                      {active ? <span className="text-sm text-muted">{m.app.tickets.lastAttempt} <time className="ltr-nums" dateTime={info.lastAttemptAt}>{fmt.dateTime(info.lastAttemptAt, { hour: "numeric", minute: "2-digit", hour12: true })}</time></span> : null}
                    </div>
                    <p className="mt-2 font-semibold leading-relaxed">{ticket.message}</p>
                    {active ? (
                      <p className="mt-2 text-sm text-muted">{m.app.tickets.callbackRule}</p>
                    ) : (
                      <p className="mt-2 text-sm text-muted">
                        {ticket.closedAt
                          ? <>{m.app.tickets.closedAt} <time className="ltr-nums" dateTime={ticket.closedAt}>{fmt.dateTime(ticket.closedAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</time></>
                          : m.app.tickets.closedByCallback}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {relays.length ? (
        <Card>
          <CardHeader title={m.app.tickets.relays} icon={<CheckCircle size={19} aria-hidden />} />
          <CardBody className="pt-3">
            <ul className="divide-y divide-stone/70">
              {relays.map((relay) => (
                <li key={relay.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={relay.delivered ? "ok" : "warn"} dot>{relay.delivered ? m.app.tickets.delivered : m.app.tickets.notDelivered}</Badge>
                    <span className="text-xs text-muted">{m.app.tickets.relayedAt(fmt.relative(relay.at, now))}</span>
                  </div>
                  <p className="mt-2 font-semibold leading-relaxed">{relay.message}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {!hasVisibleItems ? (
        <Card><EmptyState title={active ? m.app.tickets.emptyActive : m.app.tickets.emptyHistory} /></Card>
      ) : null}
    </div>
  );
}
