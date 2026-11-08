"use client";

import { EstateHeader, type EstateFact, type EstateTone } from "@/components/dashboard/EstateHeader";
import { EstateLedger } from "@/components/dashboard/EstateLedger";
import { EstateMatters } from "@/components/dashboard/EstateMatters";
import { FirstReport } from "@/components/dashboard/FirstReport";
import { HerdCountFact } from "@/components/dashboard/HerdCountFact";
import { ReportCallNow } from "@/components/dashboard/ReportCallNow";
import { estateMatters } from "@/components/dashboard/matters";
import { useCallSentence } from "@/components/schedule/ReportCallSection";
import { lastReportAt, openNoAnswerTickets, openTaskTickets, ownerAllowanceUsed, routeOwnerInboundCall, sameWeek } from "@/domain";
import { useI18n } from "@/i18n/client";
import { TimeRail } from "@/components/visuals/TimeRail";
import { CallSetupStatus, formatSaudiMobile, getCallSetupGaps } from "@/components/setup";
import { useScheduledCallsOn } from "@/components/schedule/useScheduledCalls";
import { useIsAccount, useNow, useWorkspace } from "@/store/workspace";

// Short enough for a two-column header on a phone: the day and time lead, the date sits underneath.
// formatDateTime fills in every field it is not told to leave out.
const dayTime = { weekday: "short", day: undefined, month: undefined } as const;
const dateTime = { weekday: undefined } as const;
const dayMonth = { weekday: undefined, hour: undefined, minute: undefined } as const;

export default function OverviewPage() {
  const { m, fmt, href } = useI18n();
  const app = m.app;
  const d = m.setup.dashboard;
  const v = m.visual;
  const ws = useWorkspace();
  const now = useNow();
  const call = useCallSentence(ws);
  const account = useIsAccount();
  // In a real account, don't promise a scheduled call the deployment won't place.
  const scheduledCalls = useScheduledCallsOn();
  const scheduledOff = account && scheduledCalls === false;
  if (!ws) return null;

  const reportAt = lastReportAt(ws) ?? ws.lastUpdateAt;
  const latestReport = reportAt ? [...ws.reports].reverse().find((report) => report.at === reportAt) ?? null : null;
  const hasReport = Boolean(reportAt);
  const ultimate = ws.settings.plan === "ultimate";
  const worker = ws.settings.worker.name.trim() || app.overview.unnamedWorker;
  const estateName = ws.settings.farm.name.trim() || app.overview.estateFallback;
  const gaps = getCallSetupGaps(ws);

  const unanswered = openNoAnswerTickets(ws);
  const matters = estateMatters(ws, latestReport);
  const concerns = unanswered.length + matters.length;
  const tasks = ultimate ? openTaskTickets(ws) : [];
  const tone: EstateTone = !hasReport ? "quiet" : unanswered.length ? "unanswered" : concerns ? "attention" : "calm";
  const state = !hasReport ? app.overview.noUpdate : concerns ? app.overview.needsYou(concerns) : app.overview.nothingFlagged;
  // One next step. While calls still need something, the card below carries it instead.
  const action = gaps.length
    ? null
    : tasks.length
      ? { href: href("/app/tickets"), label: app.overview.viewTickets }
      : hasReport ? { href: href("/app/herd"), label: app.overview.viewHerd } : null;
  const workerPhone = ws.settings.worker.phone.trim();

  const ownerRoute = routeOwnerInboundCall(ws, now);
  const allowanceUsed = ownerAllowanceUsed(ws, now);
  const missedCallbackUsed = ws.calls.some(
    (item) => item.kind === "owner_inquiry" && item.summary.en === "Owner called back after a missed notification" && sameWeek(item.at, now),
  );

  const callNow = <ReportCallNow ws={ws} worker={worker} now={now} />;
  const next = call?.next ?? null;
  // Drawn to scale whenever the next call is known; otherwise the two plain facts below say it.
  const rhythm = next ? (
    <TimeRail
      tone="dark"
      now={now}
      label={reportAt
        ? v.rhythm.label(fmt.dateTime(reportAt, dateTime), fmt.dateTime(next, dateTime))
        : v.rhythm.firstLabel(fmt.dateTime(next, dateTime))}
      start={reportAt ? {
        at: reportAt,
        label: app.overview.lastUpdateLabel,
        value: fmt.relative(reportAt, now),
        detail: <time className="ltr-nums" dateTime={reportAt}>{fmt.dateTime(reportAt, dateTime)}</time>,
      } : null}
      startValue={v.rhythm.noReport}
      end={{
        at: next,
        label: scheduledOff ? d.plannedCall : d.nextCall,
        value: <time className="ltr-nums" dateTime={next.toISOString()}>{fmt.dateTime(next, dayTime)}</time>,
        detail: scheduledOff ? d.scheduledOff : <>{fmt.dateTime(next, dayMonth)} · {fmt.relative(next, now)}</>,
        extra: callNow,
      }}
    />
  ) : null;

  const facts: EstateFact[] = [];
  if (!rhythm && reportAt) {
    facts.push({
      key: "last",
      label: app.overview.lastUpdateLabel,
      content: (
        <>
          <p className="text-lg font-semibold leading-snug">{fmt.relative(reportAt, now)}</p>
          <p className="mt-1 text-sm text-cream/75">
            <time className="ltr-nums" dateTime={reportAt}>{fmt.dateTime(reportAt, dateTime)}</time>
          </p>
        </>
      ),
    });
  }
  if (!rhythm) {
    facts.push({
      key: "next",
      label: scheduledOff ? d.plannedCall : d.nextCall,
      content: (
        <>
          <p className="text-lg font-semibold leading-snug">{d.noCallTime}</p>
          {callNow}
        </>
      ),
    });
  }
  facts.push({
    key: "worker",
    label: app.overview.primaryWorker,
    content: ws.settings.worker.name.trim() || workerPhone ? (
      <>
        <p className="text-lg font-semibold leading-snug">{ws.settings.worker.name.trim() || app.overview.unnamedWorker}</p>
        {workerPhone ? <p className="mt-1 text-sm text-cream/75"><bdi dir="ltr" className="ltr-nums">{formatSaudiMobile(workerPhone)}</bdi></p> : null}
      </>
    ) : (
      <p className="text-lg font-semibold leading-snug">{app.overview.workerNotSet}</p>
    ),
  });
  facts.push({ key: "herd", label: d.herd, content: <HerdCountFact ws={ws} worker={worker} /> });

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
      <EstateHeader name={estateName} state={state} tone={tone} action={action} rhythm={rhythm} facts={facts} />

      <CallSetupStatus ws={ws} />

      {hasReport ? (
        <EstateMatters ws={ws} matters={matters} unanswered={unanswered} reportAt={reportAt} worker={worker} now={now} />
      ) : gaps.length ? null : (
        <FirstReport ws={ws} worker={worker} next={scheduledOff ? null : call?.next ?? null} />
      )}

      <EstateLedger ws={ws} worker={worker} hasReport={hasReport} latestReport={latestReport} allowance={allowance} />
    </div>
  );
}
