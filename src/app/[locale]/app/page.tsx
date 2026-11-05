"use client";

import { ArrowRight, CaretRight, CheckCircle, Circle, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { CertaintyBadge, EmptyState, HealthBadge, ResourceMeter, noAnswerAttemptInfo } from "@/components/dashboard/DashboardPrimitives";
import { WeatherLine } from "@/components/dashboard/WeatherLine";
import { MessageWorkerLink, OrderSupplierLink } from "@/components/integrations/WhatsAppActions";
import { EMERGENCY_LABELS, RESOURCE_LABELS, WEEKDAY_LABELS, levelLabel, nextWindowStart, openNoAnswerTickets, openTaskTickets, ownerAllowanceUsed, reportDoneThisPeriod, routeOwnerInboundCall, lastReportAt, fromRiyadh, riyadhParts, sameWeek } from "@/domain";
import type { EventTone } from "@/domain";
import { useI18n } from "@/i18n/client";
import { findingHerdTarget } from "@/components/dashboard/findingLink";
import { CallSetupStatus, getCallSetupGaps, hasCallLanguageNote, hasCompleteWindow } from "@/components/setup";
import { useNow, useWorkspace } from "@/store/workspace";

const statusText = {
  good: "text-ok",
  medium: "text-muted",
  low: "text-warn",
  critical: "text-danger",
  unknown: "text-muted",
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
  const reportWindow = hasCompleteWindow(ws.settings.window) ? ws.settings.window : null;
  const nextWindowDate = reportWindow && !reportIsCurrent ? nextWindowStart(now, reportWindow) : null;
  const workerName = ws.settings.worker.name.trim() || app.overview.unnamedWorker;
  const ownerName = ws.settings.owner.name.trim().split(/\s+/)[0] ?? "";
  const showCallSetup = getCallSetupGaps(ws).length > 0 || hasCallLanguageNote(ws);
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
  const recentEvents = [...ws.events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  const emergencyLabels = ws.settings.emergencies.map((category) =>
    category.kind === "custom" ? category.label || app.overview.unknown : t(EMERGENCY_LABELS[category.kind]),
  );

  const camelHref = (id: string) => `${href("/app/herd")}#camel-${id}`;
  const estateName = ws.settings.farm.name.trim() || app.overview.estateFallback;
  const hasReport = Boolean(reportAt);
  const workerPhone = ws.settings.worker.phone.replace(/[\s()-]/g, "");
  const showTasks = ws.settings.plan === "ultimate" || pendingRelays.length > 0;
  const hasAttention = Boolean(latestReport?.findings.length) || noAnswerTickets.length > 0;
  const setupLinks = [
    { label: app.overview.setupQuestions, target: "#settings-questions" },
    { label: app.overview.setupWorker, target: "#settings-worker" },
    { label: app.overview.setupCriteria, target: "#settings-criteria" },
    { label: app.overview.setupEmergencies, target: "#settings-emergencies" },
  ];

  // Work waiting on the worker reads right after the findings, ahead of the farm's standing state.
  const openItemsLead = hasReport && (ws.settings.plan === "ultimate" ? taskTickets.length > 0 : pendingRelays.length > 0);
  const openItems = (
    <Card>
      <CardHeader title={app.overview.openItems} action={<ButtonLink href={href("/app/tickets")} variant="ghost" size="sm" className="-me-3 min-h-11 text-brown">{app.overview.viewTickets}</ButtonLink>} />
      <CardBody className="pt-3">
        {ws.settings.plan === "ultimate" ? (
          taskTickets.length ? (
            <ul className="divide-y divide-stone/70">
              {taskTickets.slice(0, 4).map((ticket) => (
                <li key={ticket.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`${href("/app/tickets")}#task-${ticket.id}`} className="group flex items-start justify-between gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown">
                    <span className="min-w-0">
                      <span className="block font-semibold leading-relaxed group-hover:text-brown">{ticket.instruction}</span>
                      <span className="mt-1 block text-sm text-muted">
                        {ticket.scheduledFor
                          ? <>{app.overview.taskScheduledPrefix} <time className="ltr-nums" dateTime={ticket.scheduledFor}>{fmt.dateTime(ticket.scheduledFor, { hour: "numeric", minute: "2-digit", hour12: true })}</time> {app.overview.taskScheduledSuffix(workerName)}</>
                          : app.overview.taskAnyTime(workerName)}
                      </span>
                      <span className="mt-1 block text-xs text-muted">{app.overview.created(fmt.relative(ticket.createdAt, now))}</span>
                    </span>
                    <CaretRight size={16} className="mt-1.5 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">{app.overview.noOpenItems}</p>
        ) : (
          <ul className="divide-y divide-stone/70">
            {pendingRelays.slice(0, 5).map((relay) => (
              <li key={relay.id} className="py-3 first:pt-0 last:pb-0">
                <p className="font-semibold leading-relaxed">{relay.message}</p>
                <p className="mt-1 text-xs text-muted">{app.overview.created(fmt.relative(relay.at, now))}</p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );

  return (
    <div className="space-y-5 pb-8">
      <header className="pt-1">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-espresso sm:text-[2.25rem]">{estateName}</h1>
        <p className="mt-1 text-muted">{greeting(ownerName)}</p>
        <WeatherLine />
      </header>

      {/* The one question: has the update arrived, and what comes next? */}
      <Card>
        <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="text-sm font-semibold text-muted">{app.overview.lastUpdateLabel}</p>
            {reportAt ? (
              <>
                <p className="mt-1 text-2xl font-semibold leading-tight text-espresso">{fmt.relative(reportAt, now)}</p>
                <p className="mt-1 text-sm text-muted">
                  <time className="ltr-nums" dateTime={reportAt}>{fmt.dateTime(reportAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</time>
                  <span> · {app.overview.reportedBy(workerName)}</span>
                </p>
                {!reportIsCurrent ? (
                  <p className="mt-1 text-sm font-semibold text-warn">{ws.settings.plan === "ultimate" ? app.overview.awaitingToday : app.overview.awaitingWeek}</p>
                ) : null}
              </>
            ) : <p className="mt-1 text-xl font-semibold leading-tight text-espresso">{app.overview.noUpdate}</p>}
          </div>
          <div>
            <p className="text-sm font-semibold text-muted">{app.overview.nextExpected}</p>
            <p className="mt-1 text-lg font-semibold leading-snug text-espresso">
              {ws.settings.plan === "ultimate"
                ? reportIsCurrent
                  ? app.overview.receivedToday
                  : app.overview.todayEndOfDay(workerName)
                : reportIsCurrent
                  ? app.overview.receivedWeek
                  : reportWindow
                    ? <>
                        <span>{t(WEEKDAY_LABELS[reportWindow.day])}{locale === "ar" ? "، " : ", "}</span>
                        <time className="ltr-nums" dateTime={reportWindow.start}>{fmt.time(timeForWindow(reportWindow.start, now))}</time>
                        <span aria-hidden>–</span>
                        <time className="ltr-nums" dateTime={reportWindow.end}>{fmt.time(timeForWindow(reportWindow.end, now))}</time>
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
          <ButtonLink href={href("/app/lab")} className="w-full sm:col-span-2 lg:col-span-1 lg:w-auto">
            {app.overview.simulateCall}
            <ArrowRight size={17} className="rtl:-scale-x-100" aria-hidden />
          </ButtonLink>
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          {hasReport ? (
            <>
              <Card>
                <CardHeader title={app.overview.attention} />
                <CardBody className="pt-3">
                  {hasAttention ? (
                    <ul className="divide-y divide-stone/70">
                      {latestReport?.findings.map((finding) => {
                        const herdTarget = findingHerdTarget(ws, finding);
                        return (
                          <li key={finding.id} className="py-3 first:pt-0 last:pb-0">
                            {herdTarget ? (
                              <Link
                                href={herdTarget.camelId ? camelHref(herdTarget.camelId) : href("/app/herd")}
                                className="group flex min-h-11 items-start gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown"
                              >
                                <WarningCircle className="mt-0.5 shrink-0 text-warn" size={19} weight="fill" aria-hidden />
                                <span className="min-w-0 flex-1 font-medium leading-relaxed text-espresso underline decoration-stone underline-offset-4 group-hover:decoration-brown">{t(finding.text)}</span>
                                <CaretRight size={16} className="mt-1.5 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
                              </Link>
                            ) : (
                              <div className="flex items-start gap-3">
                                <WarningCircle className="mt-0.5 shrink-0 text-warn" size={19} weight="fill" aria-hidden />
                                <p className="font-medium leading-relaxed text-espresso">{t(finding.text)}</p>
                              </div>
                            )}
                          </li>
                        );
                      })}
                      {noAnswerTickets.slice(0, 4).map((ticket) => {
                        const info = noAnswerAttemptInfo(ws, ticket);
                        return (
                          <li key={ticket.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                            <WarningCircle className="mt-0.5 shrink-0 text-danger" size={19} weight="fill" aria-hidden />
                            <div className="min-w-0">
                              <p className="font-semibold text-espresso">{app.overview.workerMissedAttempts(workerName, fmt.number(info.count))}</p>
                              <p className="mt-1 text-sm leading-relaxed text-espresso">{ticket.message}</p>
                              <p className="mt-1 text-sm text-muted">{app.overview.workerMayCallBack}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p className="text-muted">{app.overview.noFindings}</p>}
                </CardBody>
              </Card>

              {openItemsLead ? openItems : null}

              <Card>
                <CardHeader title={app.overview.resources} />
                <CardBody className="pt-3">
                  <ul className="divide-y divide-stone/70">
                    {resources.map((resource) => (
                      <li key={resource.kind} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-semibold">{t(RESOURCE_LABELS[resource.kind])}</span>
                            <span className={`text-sm font-medium ${statusText[resource.level]}`}>{t(levelLabel(resource.kind, resource.level))}</span>
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
                      <li key={resource.kind} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm text-muted last:pb-0">
                        <span>{t(RESOURCE_LABELS[resource.kind])}</span>
                        <span>{app.overview.notOnFarm}</span>
                      </li>
                    ))}
                  </ul>
                  <OrderSupplierLink kinds={["feed", "water"]} />
                </CardBody>
              </Card>

              <Card>
                <CardHeader title={app.overview.herdSummary} action={<ButtonLink href={href("/app/herd")} variant="ghost" size="sm" className="-me-3 min-h-11 text-brown">{app.overview.viewHerd}</ButtonLink>} />
                <CardBody className="pt-3">
                  <dl className="grid grid-cols-3 gap-y-4 border-b border-stone/70 pb-4 sm:grid-cols-5">
                    {[
                      [app.overview.totalCamels, ws.camels.length],
                      [app.overview.healthy, herdCounts.healthy],
                      [app.overview.watch, herdCounts.watch],
                      [app.overview.sick, herdCounts.sick],
                      [app.overview.unknown, herdCounts.unknown],
                    ].map(([label, count]) => (
                      <div key={label} className="flex flex-col-reverse">
                        <dt className="mt-1 text-xs leading-snug text-muted">{label}</dt>
                        <dd className="ltr-nums text-start text-2xl font-semibold tabular-nums leading-none text-espresso">{fmt.number(Number(count))}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4">
                    <h3 className="mb-2 text-sm font-semibold text-muted">{app.overview.needsAttention}</h3>
                    {attentionCamels.length ? (
                      <ul className="divide-y divide-stone/70">
                        {attentionCamels.map((camel) => (
                          <li key={camel.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                            <div className="min-w-0">
                              <Link href={camelHref(camel.id)} className="inline-flex min-h-11 items-center font-semibold underline decoration-stone underline-offset-4 hover:decoration-brown">{camel.name}</Link>
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
            </>
          ) : (
            <Card>
              <EmptyState
                camel
                title={app.overview.firstReportTitle}
                body={app.overview.firstReportBody}
                action={
                  ws.camels.length ? (
                    <ButtonLink href={href("/app/herd")} variant="secondary">{app.herd.count(fmt.number(ws.camels.length))}</ButtonLink>
                  ) : (
                    <ButtonLink href={href("/app/herd")} variant="secondary">{app.overview.addCamels}</ButtonLink>
                  )
                }
              />
            </Card>
          )}

          {!hasReport && showCallSetup ? <CallSetupStatus ws={ws} settingsHref={href("/app/settings")} /> : null}

          {showTasks && !openItemsLead ? openItems : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-5 lg:col-span-4">
          {hasReport && showCallSetup ? <CallSetupStatus ws={ws} settingsHref={href("/app/settings")} /> : null}

          {ws.settings.plan === "basic" ? (
            <Card>
              <CardHeader title={app.overview.allowance} />
              <CardBody className="pt-3">
                <p className="font-semibold">
                  {allowanceUsed && ws.ownerAllowanceUsedAt ? <>{app.overview.allowanceUsed} <time className="ltr-nums" dateTime={ws.ownerAllowanceUsedAt}>{fmt.date(ws.ownerAllowanceUsedAt)}</time></> : app.overview.allowanceAvailable}
                </p>
                {ownerRoute.kind === "inquiry" && ownerRoute.mode === "missed_callback" ? (
                  <p className="mt-2 text-sm text-muted">{app.overview.callbackAvailable}</p>
                ) : missedCallbackUsed ? (
                  <p className="mt-2 text-sm text-muted">{app.overview.callbackUsed}</p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={app.overview.emergency} />
            <CardBody className="pt-3">
              <p className="font-semibold">{app.overview.emergencyInstructions}</p>
              <p className="mt-3 text-sm font-semibold text-muted">{app.overview.emergencyCategories}</p>
              {emergencyLabels.length ? (
                <p className="mt-1 text-sm leading-relaxed text-espresso">{emergencyLabels.join(locale === "ar" ? "، " : ", ")}</p>
              ) : <p className="mt-2 text-sm text-muted">{app.overview.noEmergencyCategories}</p>}
              {workerPhone ? (
                <a className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg font-semibold text-brown underline decoration-stone underline-offset-4" href={`tel:${workerPhone}`}>
                  {app.overview.callWorker}
                  <span className="ltr-nums">{ws.settings.worker.phone}</span>
                </a>
              ) : null}
              <div>
                <MessageWorkerLink />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={app.overview.setupLinks} />
            <CardBody className="pt-1">
              <ul className="divide-y divide-stone/70">
                {setupLinks.map((link) => (
                  <li key={link.target}>
                    <Link href={`${href("/app/settings")}${link.target}`} className="flex min-h-11 items-center justify-between gap-3 py-2 font-medium text-espresso transition-colors hover:text-brown">
                      {link.label}
                      <CaretRight size={16} className="shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {recentEvents.length ? (
            <Card>
              <CardHeader title={app.overview.activity} action={<ButtonLink href={href("/app/calls")} variant="ghost" size="sm" className="-me-3 min-h-11 text-brown">{app.overview.viewCalls}</ButtonLink>} />
              <CardBody className="pt-3">
                <ul className="divide-y divide-stone/70">
                  {recentEvents.map((event) => (
                    <li key={event.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="mt-0.5"><EventMarker tone={event.tone} /></span>
                      <div className="min-w-0">
                        <p className="text-sm leading-relaxed">{t(event.text)}</p>
                        <p className="mt-1 text-xs text-muted">{fmt.relative(event.at, now)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
