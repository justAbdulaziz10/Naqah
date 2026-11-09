"use client";

import { EmergencyStrip } from "@/components/dashboard/EmergencyStrip";
import { EstateCalls } from "@/components/dashboard/EstateCalls";
import { EstateHeader, type EstateTone } from "@/components/dashboard/EstateHeader";
import { EstateMatters } from "@/components/dashboard/EstateMatters";
import { FirstReport } from "@/components/dashboard/FirstReport";
import { HerdField } from "@/components/dashboard/HerdField";
import { ReportCallNow } from "@/components/dashboard/ReportCallNow";
import { ReportLedger } from "@/components/dashboard/ReportLedger";
import { latestReportIsOld, noVerifiedReport, workerCallStatus } from "@/components/dashboard/callStatus";
import { estateMatters } from "@/components/dashboard/matters";
import { useCallSentence } from "@/components/schedule/ReportCallSection";
import { CallSetupStatus, getCallSetupGaps } from "@/components/setup";
import { useScheduledCallsOn } from "@/components/schedule/useScheduledCalls";
import { RhythmStrip } from "@/components/visuals/RhythmStrip";
import { HEALTH_LABELS, lastReportAt, ownerAllowanceUsed, ownerMissedCallbackUsed, routeOwnerInboundCall } from "@/domain";
import { undeliveredCalls } from "@/domain/alerts";
import { reportRhythm } from "@/domain/rhythm";
import { useI18n } from "@/i18n/client";
import { useIsAccount, useNow, useWorkspace } from "@/store/workspace";

const dateTime = { weekday: "short" } as const;

export default function OverviewPage() {
  const { m, t, fmt, locale } = useI18n();
  const o = m.app.overview;
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
  const worker = ws.settings.worker.name.trim() || o.unnamedWorker;
  const estateName = ws.settings.farm.name.trim() || o.estateFallback;
  const gaps = getCallSetupGaps(ws);
  const next = call?.next ?? null;

  const workerStatus = workerCallStatus(ws, now);
  // Attempts ended with nothing saved: the latest report, if any, is not this call's.
  const noVerified = noVerifiedReport(workerStatus);
  const undelivered = undeliveredCalls(ws);
  const matters = estateMatters(ws, latestReport);
  // A call that didn't get through is said with its task or message, so it counts once.
  const folded = new Set(matters.flatMap((matter) => matter.instructions.map((item) => item.id)));
  const standalone = undelivered.filter((item) => !item.taskIds.some((id) => folded.has(id)) && !(item.relayId && folded.has(item.relayId)));
  const concerns = standalone.length + matters.length;
  const tone: EstateTone = noVerified ? "unanswered" : !hasReport ? "quiet" : undelivered.length || matters[0]?.camel?.health === "sick" ? "unanswered" : concerns ? "attention" : "calm";

  // The answer names the first thing that needs the owner; the rest wait below.
  const top = matters[0] ?? null;
  const healthWord = (health: keyof typeof HEALTH_LABELS) => (locale === "en" ? t(HEALTH_LABELS[health]).toLowerCase() : t(HEALTH_LABELS[health]));
  const answer = noVerified
    ? o.answerNoVerified(worker)
    : !hasReport
      ? o.noUpdate
      : undelivered.length
        ? undelivered.some((item) => item.purpose === "instruction") ? o.answerUndelivered(worker) : o.answerCheckUndelivered(worker)
        : top?.camel && (top.camel.health === "sick" || top.camel.health === "watch")
          ? o.answerCamel(top.camel.name, healthWord(top.camel.health))
          : top?.camel
            ? o.answerAbout(top.camel.name)
            : top?.findings.length
              ? o.answerFinding(worker)
              : top
                ? o.answerWaiting(worker)
                : latestReportIsOld(ws, now, reportAt)
                  ? o.answerCalmOld(worker)
                  : o.answerCalm(worker);
  const more = concerns > 1 ? o.moreBelow(concerns - 1) : null;
  const provenance = reportAt ? (
    <>
      {noVerified ? o.lastVerified : o.fromReport(worker)} · <time className="ltr-nums" dateTime={reportAt}>{fmt.dateTime(reportAt, dateTime)}</time> · {fmt.relative(reportAt, now)}
      {more ? <> · <span className="font-semibold text-cream">{more}</span></> : null}
    </>
  ) : next ? o.firstReportSub : o.noScheduleSub;

  // Three honest states: no call time yet; a time saved but calling not switched on; a call ahead.
  const nextBlock = (
    <EstateCalls
      ws={ws}
      now={now}
      worker={worker}
      hasReport={hasReport}
      scheduledOff={scheduledOff}
      nextWorker={next}
      workerStatus={workerStatus}
      callNow={<ReportCallNow ws={ws} worker={worker} now={now} />}
    />
  );

  const slots = reportRhythm(ws, now, ws.settings.plan === "basic" ? 6 : 7, 3);
  const showStrip = Boolean(next) || slots.some((slot) => slot.state === "saved" || slot.state === "missed");
  const rhythm = showStrip ? <RhythmStrip slots={slots} weekly={ws.settings.plan === "basic"} now={now} planned={scheduledOff} /> : null;

  const ownerRoute = routeOwnerInboundCall(ws, now);
  const allowanceUsed = ownerAllowanceUsed(ws, now);
  const missedCallbackUsed = ownerMissedCallbackUsed(ws, now);
  const allowance = ws.settings.plan === "ultimate" ? null : (
    <div className="min-w-0 lg:max-w-xs lg:border-s lg:border-stone/70 lg:ps-8">
      <p className="text-sm text-muted">{o.allowance}</p>
      <p className="font-semibold text-espresso">
        {allowanceUsed && ws.ownerAllowanceUsedAt ? <>{o.allowanceUsed} <time className="ltr-nums" dateTime={ws.ownerAllowanceUsedAt}>{fmt.date(ws.ownerAllowanceUsedAt)}</time></> : o.allowanceAvailable}
      </p>
      {ownerRoute.kind === "inquiry" && ownerRoute.mode === "missed_callback" ? (
        <p className="mt-1 text-sm text-muted">{o.callbackAvailable}</p>
      ) : missedCallbackUsed ? (
        <p className="mt-1 text-sm text-muted">{o.callbackUsed}</p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5 pb-8">
      <EstateHeader name={estateName} answer={answer} tone={tone} provenance={provenance} rhythm={rhythm} next={nextBlock} />

      <CallSetupStatus ws={ws} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {hasReport ? (
            <EstateMatters ws={ws} matters={matters} undelivered={undelivered} reportAt={reportAt} worker={worker} now={now} />
          ) : gaps.length ? null : (
            <FirstReport ws={ws} worker={worker} />
          )}
          {latestReport ? <ReportLedger ws={ws} report={latestReport} worker={worker} /> : null}
        </div>
        <HerdField ws={ws} worker={worker} />
      </div>

      <EmergencyStrip ws={ws} worker={worker} allowance={allowance} />
    </div>
  );
}
