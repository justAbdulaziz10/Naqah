"use client";

import { ArrowRight, CheckCircle, Circle, PhoneCall, WarningCircle } from "@phosphor-icons/react";
import { Badge, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { CertaintyBadge, EmptyState, HealthBadge, ResourceMeter, noAnswerAttemptInfo } from "@/components/dashboard/DashboardPrimitives";
import { EMERGENCY_LABELS, RESOURCE_LABELS, WEEKDAY_LABELS, levelLabel, nextWindowStart, openNoAnswerTickets, openTaskTickets, ownerAllowanceUsed, reportDoneThisPeriod, routeOwnerInboundCall, lastReportAt, fromRiyadh, riyadhParts, sameWeek } from "@/domain";
import type { EventTone } from "@/domain";
import { useI18n } from "@/i18n/client";
import { useNow, useWorkspace } from "@/store/workspace";

const statusTone = {
  good: "ok",
  medium: "info",
  low: "warn",
  critical: "danger",
  unknown: "neutral",
} as const;

function timeForWindow(value: string, now: Date) {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  const parts = riyadhParts(now);
  return fromRiyadh(parts.year, parts.month, parts.day, hours, minutes);
}

function EventMarker({ tone }: { tone: EventTone }) {
  const Icon = tone === "success" ? CheckCircle : tone === "attention" || tone === "danger" ? WarningCircle : Circle;
  const className = tone === "success" ? "text-ok" : tone === "attention" ? "text-warn" : tone === "danger" ? "text-danger" : "text-muted";
  return <Icon size={19} weight="fill" className={className} aria-hidden />;
}

export default function OverviewPage() {
  const { m, t, fmt, href, locale } = useI18n();
  const app = m.app;
  const ws = useWorkspace();
  const now = useNow();
  if (!ws) return null;

  const reportAt = lastReportAt(ws) ?? ws.lastUpdateAt;
  const latestReport = reportAt ? [...ws.reports].reverse().find((report) => report.at === reportAt) ?? null : null;
  const reportIsCurrent = reportDoneThisPeriod(ws, now);
  const nextWindowDate = ws.settings.window && !reportIsCurrent ? nextWindowStart(now, ws.settings.window) : null;
  const workerName = ws.settings.worker.name || (locale === "en" ? "Ahmed" : "أحمد");
  const ownerName = ws.settings.owner.name.trim().split(/\s+/)[0] || (locale === "en" ? "Abdullah" : "عبدالله");
  const hour = riyadhParts(now).hours;
  const greeting = hour < 12 ? app.overview.greetingMorning : hour < 18 ? app.overview.greetingAfternoon : app.overview.greetingEvening;
  const taskTickets = openTaskTickets(ws);
  const noAnswerTickets = openNoAnswerTickets(ws);
  const pendingRelays = ws.relays.filter((relay) => !relay.delivered);
  const ownerRoute = routeOwnerInboundCall(ws, now);
  const allowanceUsed = ownerAllowanceUsed(ws, now);
  const missedCallbackUsed = ws.calls.some(
    (call) => call.kind === "owner_inquiry" && call.summary.en === "Owner called back after a missed notification" && sameWeek(call.at, now),
  );
  const resources = ws.resources.filter((resource) => resource.present);
  const absentResources = ws.resources.filter((resource) => !resource.present);
  const herdCounts = {
    healthy: ws.camels.filter((camel) => camel.health === "healthy").length,
    watch: ws.camels.filter((camel) => camel.health === "watch").length,
    sick: ws.camels.filter((camel) => camel.health === "sick").length,
    unknown: ws.camels.filter((camel) => camel.health === "unknown").length,
  };
  const attentionCamels = ws.camels.filter((camel) => camel.health !== "healthy").slice(0, 4);
  const recentEvents = [...ws.events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8);
  const emergencyLabels = ws.settings.emergencies.map((category) =>
    category.kind === "custom" ? category.label || app.overview.unknown : t(EMERGENCY_LABELS[category.kind]),
  );

  return (
    <div className="animate-fade-up space-y-5 pb-8">
      <header className="rounded-[var(--radius-card)] border border-stone/80 bg-cream px-5 py-5 shadow-soft sm:px-7 sm:py-6">
        <h1 className="text-2xl font-bold leading-tight text-espresso sm:text-[1.8rem]">{greeting(ownerName)}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {reportAt ? (
            <p>
              {app.overview.lastUpdate} <time className="ltr-nums" dateTime={reportAt}>{fmt.dateTime(reportAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</time>
              <span> · {fmt.relative(reportAt, now)}</span>
            </p>
          ) : <p>{app.overview.noUpdate}</p>}
          {reportAt && !reportIsCurrent ? (
            <Badge tone="warn" dot>{ws.settings.plan === "ultimate" ? app.overview.awaitingToday : app.overview.awaitingWeek}</Badge>
          ) : null}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          <Card>
            <CardHeader title={app.overview.nextExpected} icon={<PhoneCall size={19} weight="fill" aria-hidden />} />
            <CardBody className="flex flex-col items-start gap-4 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-espresso">
                  {ws.settings.plan === "ultimate"
                    ? reportIsCurrent
                      ? app.overview.receivedToday
                      : app.overview.todayEndOfDay(workerName)
                    : reportIsCurrent
                      ? app.overview.receivedWeek
                    : ws.settings.window
                        ? <>
                            <span>{t(WEEKDAY_LABELS[ws.settings.window.day])}{locale === "ar" ? "، " : ", "}</span>
                            <time className="ltr-nums" dateTime={ws.settings.window.start}>{fmt.time(timeForWindow(ws.settings.window.start, now))}</time>
                            <span aria-hidden>–</span>
                            <time className="ltr-nums" dateTime={ws.settings.window.end}>{fmt.time(timeForWindow(ws.settings.window.end, now))}</time>
                          </>
                        : app.overview.noWindowSet}
                </p>
                {nextWindowDate ? (
                  <p className="mt-1 text-sm text-muted">
                    {app.overview.nextWindowAt} <time className="ltr-nums" dateTime={nextWindowDate.toISOString()}>{fmt.dateTime(nextWindowDate, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}</time>
                  </p>
                ) : null}
              </div>
              <ButtonLink href={href("/app/lab")} className="w-full sm:w-auto">
                {app.overview.simulateCall}
                <ArrowRight size={17} className="rtl:-scale-x-100" aria-hidden />
              </ButtonLink>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={app.overview.findings} />
            <CardBody className="pt-3">
              {latestReport?.findings.length ? (
                <ul className="divide-y divide-stone/70">
                  {latestReport.findings.map((finding) => (
                    <li key={finding.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <WarningCircle className="mt-0.5 shrink-0 text-warn" size={19} weight="fill" aria-hidden />
                      <p className="text-sm font-medium leading-relaxed text-espresso">{t(finding.text)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={app.overview.noFindings} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={app.overview.openItems} action={<ButtonLink href={href("/app/tickets")} variant="ghost" size="sm" className="min-h-11">{app.overview.viewTickets}</ButtonLink>} />
            <CardBody className="space-y-5 pt-3">
              {ws.settings.plan === "ultimate" ? (
                <>
                  {taskTickets.length ? (
                    <section aria-labelledby="open-task-title">
                      <h3 id="open-task-title" className="mb-2 text-sm font-semibold text-muted">{app.overview.taskTickets}</h3>
                      <ul className="divide-y divide-stone/70">
                        {taskTickets.slice(0, 4).map((ticket) => (
                          <li key={ticket.id} className="py-3 first:pt-0 last:pb-0">
                            <p className="font-semibold leading-relaxed">{ticket.instruction}</p>
                            <p className="mt-1 text-sm text-muted">
                              {ticket.scheduledFor
                                ? <>{app.overview.taskScheduledPrefix} <time className="ltr-nums" dateTime={ticket.scheduledFor}>{fmt.dateTime(ticket.scheduledFor, { hour: "numeric", minute: "2-digit", hour12: true })}</time> {app.overview.taskScheduledSuffix(workerName)}</>
                                : app.overview.taskAnyTime(workerName)}
                            </p>
                            <p className="mt-1 text-xs text-faint">{app.overview.created(fmt.relative(ticket.createdAt, now))}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {noAnswerTickets.length ? (
                    <section aria-labelledby="no-answer-title">
                      <h3 id="no-answer-title" className="mb-2 text-sm font-semibold text-danger">{app.overview.noAnswerTickets}</h3>
                      <ul className="divide-y divide-danger/15 rounded-xl bg-danger-soft/55 px-4">
                        {noAnswerTickets.slice(0, 4).map((ticket) => {
                          const info = noAnswerAttemptInfo(ws, ticket);
                          return (
                            <li key={ticket.id} className="py-3 first:pt-4 last:pb-4">
                              <p className="font-semibold text-espresso">{app.overview.workerMissedAttempts(workerName, fmt.number(info.count))}</p>
                              <p className="mt-1 text-sm leading-relaxed text-espresso">{ticket.message}</p>
                              <p className="mt-1 text-sm text-muted">{app.overview.workerMayCallBack}</p>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ) : null}
                  {!taskTickets.length && !noAnswerTickets.length ? <EmptyState title={app.overview.noOpenItems} /> : null}
                </>
              ) : pendingRelays.length ? (
                <ul className="divide-y divide-stone/70">
                  {pendingRelays.slice(0, 5).map((relay) => (
                    <li key={relay.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="font-semibold leading-relaxed">{relay.message}</p>
                      <p className="mt-1 text-xs text-faint">{app.overview.created(fmt.relative(relay.at, now))}</p>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title={app.overview.noOpenItems} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={app.overview.resources} />
            <CardBody className="pt-3">
              <ul className="divide-y divide-stone/70">
                {resources.map((resource) => (
                  <li key={resource.kind} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold">{t(RESOURCE_LABELS[resource.kind])}</span>
                        <Badge tone={statusTone[resource.level]}>{t(levelLabel(resource.kind, resource.level))}</Badge>
                      </div>
                      {resource.quantity ? <p className="mt-1 text-sm text-muted">{resource.quantity}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                      <ResourceMeter kind={resource.kind} level={resource.level} />
                      <CertaintyBadge certainty={resource.certainty} />
                      {resource.updatedAt ? <span className="text-xs text-muted">{app.overview.updated(fmt.relative(resource.updatedAt, now))}</span> : null}
                    </div>
                  </li>
                ))}
                {absentResources.map((resource) => (
                  <li key={resource.kind} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm text-faint last:pb-0">
                    <span>{t(RESOURCE_LABELS[resource.kind])}</span>
                    <span>{app.overview.notOnFarm}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={app.overview.herdSummary} action={<ButtonLink href={href("/app/herd")} variant="ghost" size="sm" className="min-h-11">{app.overview.viewHerd}</ButtonLink>} />
            <CardBody className="pt-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  [app.overview.totalCamels, ws.camels.length],
                  [app.overview.healthy, herdCounts.healthy],
                  [app.overview.watch, herdCounts.watch],
                  [app.overview.sick, herdCounts.sick],
                  [app.overview.unknown, herdCounts.unknown],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-xl bg-ivory px-3 py-2.5">
                    <p className="text-lg font-bold leading-none text-espresso">{fmt.number(Number(count))}</p>
                    <p className="mt-1.5 text-xs leading-snug text-muted">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-muted">{app.overview.needsAttention}</h3>
                {attentionCamels.length ? (
                  <ul className="divide-y divide-stone/70">
                    {attentionCamels.map((camel) => (
                      <li key={camel.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="font-semibold">{camel.name} <span className="ms-1 text-xs font-medium text-muted ltr-nums">{camel.tag}</span></p>
                          <p className="mt-1 text-sm leading-relaxed text-muted">{camel.healthNote || app.herd.noHealthNote}</p>
                          <div className="mt-2"><CertaintyBadge certainty={camel.certainty} /></div>
                        </div>
                        <HealthBadge health={camel.health} />
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">{app.overview.noCamelsNeedAttention}</p>}
              </div>
            </CardBody>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-5 lg:col-span-4">
          <Card>
            <CardHeader title={app.overview.allowance} />
            <CardBody className="pt-3">
              {ws.settings.plan === "ultimate" ? (
                <Badge tone="ok" dot>{app.overview.unlimitedCalls}</Badge>
              ) : (
                <>
                  <p className="font-semibold">
                    {allowanceUsed && ws.ownerAllowanceUsedAt ? <>{app.overview.allowanceUsed} <time className="ltr-nums" dateTime={ws.ownerAllowanceUsedAt}>{fmt.date(ws.ownerAllowanceUsedAt)}</time></> : app.overview.allowanceAvailable}
                  </p>
                  {ownerRoute.kind === "inquiry" && ownerRoute.mode === "missed_callback" ? (
                    <p className="mt-2 text-sm text-muted">{app.overview.callbackAvailable}</p>
                  ) : missedCallbackUsed ? (
                    <p className="mt-2 text-sm text-muted">{app.overview.callbackUsed}</p>
                  ) : null}
                </>
              )}
            </CardBody>
          </Card>

          <Card className="border-brown/25">
            <CardHeader title={app.overview.emergency} icon={<WarningCircle size={19} weight="fill" aria-hidden />} />
            <CardBody className="pt-3">
              <p className="font-semibold">{app.overview.emergencyInstructions}</p>
              <p className="mt-3 text-sm font-semibold text-muted">{app.overview.emergencyCategories}</p>
              {emergencyLabels.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {emergencyLabels.map((label, index) => <li key={`${label}-${index}`}><Badge tone="neutral">{label}</Badge></li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-muted">{app.overview.noEmergencyCategories}</p>}
              <a className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg font-semibold text-brown underline decoration-stone underline-offset-4" href={`tel:${ws.settings.worker.phone.replace(/[\s()-]/g, "")}`}>
                {app.overview.callWorker}
                <span className="ltr-nums">{ws.settings.worker.phone}</span>
              </a>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={app.overview.activity} action={<ButtonLink href={href("/app/calls")} variant="ghost" size="sm" className="min-h-11">{app.overview.viewCalls}</ButtonLink>} />
            <CardBody className="pt-3">
              {recentEvents.length ? (
                <ul className="divide-y divide-stone/70">
                  {recentEvents.map((event) => (
                    <li key={event.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="mt-0.5"><EventMarker tone={event.tone} /></span>
                      <div className="min-w-0">
                        <p className="text-sm leading-relaxed">{t(event.text)}</p>
                        <p className="mt-1 text-xs text-faint">{fmt.relative(event.at, now)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title={app.overview.noActivity} />}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
