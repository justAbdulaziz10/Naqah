"use client";

import { ArrowRight, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { EmptyState } from "@/components/dashboard/DashboardPrimitives";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { useHashTarget } from "@/components/dashboard/useHashTarget";
import { callKindLabel } from "@/components/dashboard/callLabels";
import { TaskCalendarLink } from "@/components/integrations/TaskCalendarLink";
import { VerificationSteps } from "@/components/tasks/VerificationSteps";
import { AttemptDots } from "@/components/visuals/AttemptDots";
import { Badge, ButtonLink, Card, Segmented } from "@/components/ui";
import { openTaskTickets } from "@/domain";
import type { TaskTicket } from "@/domain";
import { undeliveredCalls, type UndeliveredCall } from "@/domain/alerts";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useIsAccount, useNow, useWorkspace, useWorkspaceStore } from "@/store/workspace";
import { accountSync, reportCallNow } from "@/store/account";
import { retryUndeliveredCall } from "@/domain/actions";

type TicketTab = "active" | "history";


function TicketGroup({ id, title, quiet = false, footer, children }: { id: string; title: string; quiet?: boolean; footer?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="px-5 py-5 sm:px-8 sm:py-6">
      {/* The page header has already said "1 open task"; the open list keeps its name for screen readers only. */}
      <h2 id={id} className={cn("text-xl font-semibold leading-tight tracking-[-0.01em] text-espresso", quiet && "sr-only")}>{title}</h2>
      <ul className={cn("naqah-stagger divide-y divide-stone/70", !quiet && "mt-3")}>{children}</ul>
      {footer}
    </section>
  );
}

function RetryDelivery({ id }: { id: string }) {
  const { m } = useI18n();
  const o = m.app.overview;
  const account = useIsAccount();
  const now = useNow();
  const update = useWorkspaceStore((state) => state.update);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The same call goes back in the queue, so a second press changes nothing.
  async function retry() {
    setFailed(false);
    if (!account) return update((ws) => retryUndeliveredCall(ws, now, id));
    setPending(true);
    try {
      const result = await reportCallNow.retryUndelivered(id);
      if (!result.ok) setFailed(true);
      else void accountSync.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button type="button" onClick={() => void retry()} disabled={pending} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brown underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown disabled:opacity-60">
          {pending ? o.retryingDelivery : o.retryDelivery}
      </button>
      {failed ? <p role="alert" className="text-sm text-danger">{o.retryDeliveryFailed}</p> : null}
    </>
  );
}

/** NAQAH gave up reaching the worker about this task: shown with the task, which stays open. */
function UndeliveredNote({ call, worker }: { call: UndeliveredCall; worker: string }) {
  const { m, fmt } = useI18n();
  const o = m.app.overview;
  const count = fmt.number(call.attempts);
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl bg-danger-soft/50 px-4 py-3">
      <WarningCircle size={19} weight="fill" className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0">
        <p className="naqah-name font-semibold leading-snug text-espresso">{o.notDeliveredTo(worker)}</p>
        <AttemptDots count={call.attempts} label={m.visual.tasks.attempts(count)} className="mt-1.5" />
        <p className="mt-1 text-sm text-muted">{call.purpose === "instruction" ? o.calledTimes(count) : o.calledToCheck(count)} {o.taskStaysOpen}</p>
        <RetryDelivery id={call.id} />
      </div>
    </div>
  );
}

export default function TicketsPage() {
  const { m, fmt, href } = useI18n();
  const ws = useWorkspace();
  const account = useIsAccount();
  const now = useNow();
  const [tab, setTab] = useState<TicketTab>("active");
  const linkedTaskId = useHashTarget("task-", Boolean(ws));
  const router = useRouter();
  const basic = ws?.settings.plan === "basic";
  // Basic has no tasks, so this page has nothing to show it.
  useEffect(() => {
    if (basic) router.replace(href("/app"));
  }, [basic, router, href]);
  if (!ws || basic) return null;

  const active = tab === "active";
  const worker = ws.settings.worker.name.trim() || m.app.overview.unnamedWorker;
  const closedTasks = ws.taskTickets.filter((ticket) => ticket.status === "closed");
  const openTasks = openTaskTickets(ws);
  const undelivered = undeliveredCalls(ws);
  const recentlyClosed = [...closedTasks].sort((a, b) => Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? "")).slice(0, 3);
  // Most urgent first: a check time that has passed, then the nearest check, then "any time".
  const urgency = (ticket: TaskTicket) => (ticket.scheduledFor ? Date.parse(ticket.scheduledFor) : Infinity);
  const tasks = active ? [...openTasks].sort((a, b) => urgency(a) - urgency(b)) : closedTasks;
  // A call that didn't get through is shown with its task or message.
  const taskUndelivered = (ticket: TaskTicket) => (active ? undelivered.find((item) => item.taskIds.includes(ticket.id)) ?? null : null);
  const relayUndelivered = (relayId: string) => undelivered.find((item) => item.relayId === relayId) ?? null;
  const relays = ws.relays.filter((relay) => relay.delivered !== active);
  const showTaskColumns = active && (openTasks.length > 0 || recentlyClosed.length > 0);
  const hasMainItems = tasks.length + relays.length > 0;
  const hasVisibleItems = tasks.length + relays.length + (active ? recentlyClosed.length : 0) > 0;
  const hasAnything = ws.taskTickets.length + ws.relays.length > 0;
  const waitingRelays = ws.relays.filter((relay) => !relay.delivered && !relayUndelivered(relay.id)).length;
  const summary = m.app.tickets.summary(openTasks.length, undelivered.length, waitingRelays);

  return (
    <div className="naqah-page space-y-6 pb-8">
      <PageHeader
        title={m.app.tickets.title}
        answer={hasAnything ? summary : null}
        action={hasAnything ? <Segmented
          value={tab}
          onChange={setTab}
          label={m.app.tickets.tabsLabel}
          className="w-full [&>button]:flex-1 sm:w-auto sm:[&>button]:flex-none"
          options={[
            { value: "active", label: m.app.tickets.active },
            { value: "history", label: m.app.tickets.history },
          ]}
        /> : null}
      />

      <Card className="min-w-0">
        <div className={cn(showTaskColumns && "grid items-start lg:grid-cols-[minmax(0,1.8fr)_minmax(16rem,1fr)]")}>
          <div className="min-w-0 divide-y divide-stone/70">
          {tasks.length ? (
            <TicketGroup
              id="tickets-tasks"
              title={active ? m.app.tickets.taskTickets : m.app.tickets.closedTaskTickets}
              quiet={active && !relays.length}
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
              {tasks.map((ticket, index) => {
                const stopped = taskUndelivered(ticket);
                const neverDelivered = stopped?.purpose === "instruction";
                return (
                <li
                  key={ticket.id}
                  data-hash-target={`task-${ticket.id}`}
                  tabIndex={-1}
                  style={{ "--i": index } as CSSProperties}
                  className={cn("py-5 first:pt-2 last:pb-0 focus:outline-none", linkedTaskId === ticket.id && "border-s-2 border-s-brown ps-3")}
                >
                  <p className="text-lg font-semibold leading-relaxed text-espresso">{ticket.instruction}</p>
                  {/* The worker never got this instruction, so no check or later question is on its way. */}
                  {neverDelivered
                    ? <p className="mt-2 text-sm text-muted">{m.app.tickets.created(fmt.relative(ticket.createdAt, now))}</p>
                    : <VerificationSteps ws={ws} ticket={ticket} worker={worker} now={now} className="mt-4 max-w-xl" />}
                  {stopped ? <UndeliveredNote call={stopped} worker={worker} /> : null}
                  {active && ticket.status === "open" && ticket.scheduledFor ? <TaskCalendarLink ticket={ticket} /> : null}
                  {!active && ticket.closedVia ? (
                    <p className="mt-2 text-[0.8125rem] text-muted">{m.app.tickets.closedVia(callKindLabel(ticket.closedVia, m))}</p>
                  ) : null}
                </li>
                );
              })}
            </TicketGroup>
          ) : null}

          {relays.length ? (
            <TicketGroup id="tickets-relays" title={m.app.tickets.relays}>
              {relays.map((relay, index) => (
                <li key={relay.id} className="py-5 first:pt-2 last:pb-0" style={{ "--i": index } as CSSProperties}>
                  <p className="text-lg font-semibold leading-relaxed text-espresso">{relay.message}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={relay.delivered ? "ok" : "warn"} dot>{relay.delivered ? m.app.tickets.delivered : relayUndelivered(relay.id) ? m.app.tickets.undelivered : m.app.tickets.notDelivered}</Badge>
                    <span className="text-[0.8125rem] text-muted">{m.app.tickets.relayedAt(fmt.relative(relay.at, now))}</span>
                    {!relay.delivered && relayUndelivered(relay.id) ? <span className="text-[0.8125rem] text-muted">{m.app.overview.calledTimes(fmt.number(relayUndelivered(relay.id)!.attempts))}</span> : null}
                    {!relay.delivered && relayUndelivered(relay.id) ? <RetryDelivery id={relayUndelivered(relay.id)!.id} /> : null}
                  </div>
                </li>
              ))}
            </TicketGroup>
          ) : null}

          {!hasVisibleItems ? (
            <EmptyState
              title={active ? m.app.tickets.emptyActive : m.app.tickets.emptyHistory}
              body={active ? m.app.tickets.emptyActiveBody : undefined}
              action={active && !account ? <ButtonLink href={href("/app/lab")} variant="secondary">{m.app.overview.simulateCall}</ButtonLink> : undefined}
            />
          ) : null}
          {showTaskColumns && recentlyClosed.length > 0 && !hasMainItems ? (
            <div className="hidden lg:block">
              <EmptyState title={m.app.tickets.emptyActive} body={m.app.tickets.emptyActiveBody} />
            </div>
          ) : null}
          </div>
          {showTaskColumns ? (
            <aside className={cn("min-w-0 border-t border-stone/70 lg:border-s lg:border-t-0", !recentlyClosed.length && "hidden lg:block")} aria-labelledby="tickets-recent">
              {recentlyClosed.length ? (
                <TicketGroup
                  id="tickets-recent"
                  title={m.app.tickets.recentlyClosed}
                  footer={
                    <div className="mt-3 border-t border-stone/70 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTab("history");
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="naqah-nudge inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown"
                    >
                      {m.app.tickets.allHistory}
                      <ArrowRight size={15} className="naqah-nudge-icon shrink-0 rtl:-scale-x-100" aria-hidden />
                    </button>
                    </div>
                  }
                >
                  {recentlyClosed.map((ticket, index) => (
                    <li key={ticket.id} className="py-5 first:pt-2 last:pb-0" style={{ "--i": index } as CSSProperties}>
                      <p className="font-medium leading-relaxed text-espresso">{ticket.instruction}</p>
                      <VerificationSteps ws={ws} ticket={ticket} worker={worker} now={now} className="mt-3" />
                    </li>
                  ))}
                </TicketGroup>
              ) : (
                <section className="px-5 py-5 sm:px-8 sm:py-6">
                  <h2 id="tickets-recent" className="text-xl font-semibold leading-tight tracking-[-0.01em] text-espresso">{m.app.tickets.recentlyClosed}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{m.app.tickets.emptyHistory}</p>
                </section>
              )}
            </aside>
          ) : null}
        </div>
        </Card>
    </div>
  );
}
