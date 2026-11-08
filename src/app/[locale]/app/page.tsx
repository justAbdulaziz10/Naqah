"use client";

import { ButtonLink, Card } from "@/components/ui";
import { EmptyState } from "@/components/dashboard/DashboardPrimitives";
import { EstateHeader, type EstateTone } from "@/components/dashboard/EstateHeader";
import { EstateLedger } from "@/components/dashboard/EstateLedger";
import { EstateMatters } from "@/components/dashboard/EstateMatters";
import { estateMatters } from "@/components/dashboard/matters";
import { WEEKDAY_LABELS, nextWindowStart, openNoAnswerTickets, openTaskTickets, ownerAllowanceUsed, reportDoneThisPeriod, routeOwnerInboundCall, lastReportAt, fromRiyadh, riyadhParts, sameWeek } from "@/domain";
import { useI18n } from "@/i18n/client";
import { CallSetupStatus, getCallSetupGaps, hasCallLanguageNote, hasCompleteWindow } from "@/components/setup";
import { useNow, useWorkspace } from "@/store/workspace";

function timeForWindow(value: string, now: Date) {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  const parts = riyadhParts(now);
  return fromRiyadh(parts.year, parts.month, parts.day, hours, minutes);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const dateTime = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true } as const;

export default function OverviewPage() {
  const { m, t, fmt, href, locale } = useI18n();
  const app = m.app;
  const ws = useWorkspace();
  const now = useNow();
  if (!ws) return null;

  const reportAt = lastReportAt(ws) ?? ws.lastUpdateAt;
  const latestReport = reportAt ? [...ws.reports].reverse().find((report) => report.at === reportAt) ?? null : null;
  const hasReport = Boolean(reportAt);
  const reportIsCurrent = reportDoneThisPeriod(ws, now);
  const reportWindow = hasCompleteWindow(ws.settings.window) ? ws.settings.window : null;
  const upcomingWindow = reportWindow ? nextWindowStart(now, reportWindow) : null;
  // This week's report is in, so "next" is the following week's window even if today's is still open.
  const nextWindowDate = upcomingWindow && reportIsCurrent && sameWeek(upcomingWindow, now)
    ? new Date(upcomingWindow.getTime() + WEEK_MS)
    : upcomingWindow;
  const ultimate = ws.settings.plan === "ultimate";
  const worker = ws.settings.worker.name.trim() || app.overview.unnamedWorker;
  const estateName = ws.settings.farm.name.trim() || app.overview.estateFallback;
  const showCallSetup = getCallSetupGaps(ws).length > 0 || hasCallLanguageNote(ws);

  const unanswered = openNoAnswerTickets(ws);
  const matters = estateMatters(ws, latestReport);
  const concerns = unanswered.length + matters.length;
  const tasks = ultimate ? openTaskTickets(ws) : [];
  const tone: EstateTone = !hasReport ? "quiet" : unanswered.length ? "unanswered" : concerns ? "attention" : "calm";
  const state = !hasReport ? app.overview.noUpdate : concerns ? app.overview.needsYou(concerns) : app.overview.nothingFlagged;
  const action = tasks.length
    ? { href: href("/app/tickets"), label: app.overview.viewTickets }
    : { href: href("/app/herd"), label: app.overview.viewHerd };

  const ownerRoute = routeOwnerInboundCall(ws, now);
  const allowanceUsed = ownerAllowanceUsed(ws, now);
  const missedCallbackUsed = ws.calls.some(
    (call) => call.kind === "owner_inquiry" && call.summary.en === "Owner called back after a missed notification" && sameWeek(call.at, now),
  );

  const lastUpdate = reportAt ? (
    <>
      <p className="text-2xl font-semibold leading-tight">{fmt.relative(reportAt, now)}</p>
      <p className="mt-1 text-sm text-cream/75">
        <time className="ltr-nums" dateTime={reportAt}>{fmt.dateTime(reportAt, dateTime)}</time>
        <span> · {app.overview.reportedBy(worker)}</span>
      </p>
    </>
  ) : null;

  const nextUpdate = (
    <>
      <p className="text-lg font-semibold leading-snug">
        {ultimate
          ? reportIsCurrent ? app.overview.tomorrowEndOfDay(worker) : app.overview.todayEndOfDay(worker)
          : reportWindow
              ? <>
                  <span>{t(WEEKDAY_LABELS[reportWindow.day])}{locale === "ar" ? "، " : ", "}</span>
                  <time dateTime={reportWindow.start}>{fmt.time(timeForWindow(reportWindow.start, now))}</time>
                  <span aria-hidden>–</span>
                  <time dateTime={reportWindow.end}>{fmt.time(timeForWindow(reportWindow.end, now))}</time>
                </>
              : reportIsCurrent ? app.overview.receivedWeek : app.overview.noWindowSet}
      </p>
      {nextWindowDate ? (
        <p className="mt-1 text-sm text-cream/75">
          {app.overview.nextWindowAt} <time className="ltr-nums" dateTime={nextWindowDate.toISOString()}>{fmt.dateTime(nextWindowDate, dateTime)}</time>
        </p>
      ) : null}
    </>
  );

  const allowance = ultimate ? null : (
    <div className="mt-3 border-t border-stone/70 pt-3">
      <p className="text-sm text-muted">{app.overview.allowance}</p>
      <p className="mt-0.5 font-semibold text-espresso">
        {allowanceUsed && ws.ownerAllowanceUsedAt ? <>{app.overview.allowanceUsed} <time className="ltr-nums" dateTime={ws.ownerAllowanceUsedAt}>{fmt.date(ws.ownerAllowanceUsedAt)}</time></> : app.overview.allowanceAvailable}
      </p>
      {ownerRoute.kind === "inquiry" && ownerRoute.mode === "missed_callback" ? (
        <p className="mt-1 text-sm text-muted">{app.overview.callbackAvailable}</p>
      ) : missedCallbackUsed ? (
        <p className="mt-1 text-sm text-muted">{app.overview.callbackUsed}</p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4 pb-8">
      <EstateHeader
        name={estateName}
        state={state}
        tone={tone}
        worker={worker}
        action={action}
        lastUpdate={lastUpdate}
        nextUpdate={nextUpdate}
      />

      {hasReport ? (
        <EstateMatters ws={ws} matters={matters} unanswered={unanswered} reportAt={reportAt} worker={worker} now={now} />
      ) : (
        <Card>
          <EmptyState
            camel
            title={app.overview.firstReportTitle}
            body={app.overview.firstReportBody}
            action={ws.camels.length ? undefined : <ButtonLink href={href("/app/herd")} variant="secondary">{app.overview.addCamels}</ButtonLink>}
          />
        </Card>
      )}

      {showCallSetup ? <CallSetupStatus ws={ws} settingsHref={href("/app/settings")} /> : null}

      <EstateLedger ws={ws} worker={worker} now={now} hasReport={hasReport} allowance={allowance} />
    </div>
  );
}
