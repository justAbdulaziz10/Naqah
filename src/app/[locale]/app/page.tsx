"use client";

import { ArrowRight } from "@phosphor-icons/react";
import Link from "next/link";
import { EmergencyStrip } from "@/components/dashboard/EmergencyStrip";
import { EstateHeader, type EstateTone } from "@/components/dashboard/EstateHeader";
import { EstateMatters } from "@/components/dashboard/EstateMatters";
import { FirstReport } from "@/components/dashboard/FirstReport";
import { HerdField } from "@/components/dashboard/HerdField";
import { ReportCallNow } from "@/components/dashboard/ReportCallNow";
import { ReportLedger } from "@/components/dashboard/ReportLedger";
import { estateMatters } from "@/components/dashboard/matters";
import { useCallSentence } from "@/components/schedule/ReportCallSection";
import { CallSetupStatus, getCallSetupGaps } from "@/components/setup";
import { useScheduledCallsOn } from "@/components/schedule/useScheduledCalls";
import { RhythmStrip } from "@/components/visuals/RhythmStrip";
import { HEALTH_LABELS, lastReportAt, openNoAnswerTickets, ownerAllowanceUsed, routeOwnerInboundCall, sameWeek } from "@/domain";
import { reportRhythm } from "@/domain/rhythm";
import { useI18n } from "@/i18n/client";
import { useIsAccount, useNow, useWorkspace } from "@/store/workspace";

// formatDateTime fills in every field it is not told to leave out.
const dayTime = { weekday: "long", day: undefined, month: undefined } as const;
const dateTime = { weekday: "short" } as const;
const dayMonth = { weekday: undefined, hour: undefined, minute: undefined } as const;

export default function OverviewPage() {
  const { m, t, fmt, href, locale } = useI18n();
  const o = m.app.overview;
  const d = m.setup.dashboard;
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

  const unanswered = openNoAnswerTickets(ws);
  const matters = estateMatters(ws, latestReport);
  // An unanswered check on a task is said with that task, so it counts once.
  const taskIds = new Set(matters.flatMap((matter) => matter.instructions.filter((item) => item.kind === "task").map((item) => item.id)));
  const standalone = unanswered.filter((ticket) => !ticket.taskTicketId || !taskIds.has(ticket.taskTicketId));
  const concerns = standalone.length + matters.length;
  const tone: EstateTone = !hasReport ? "quiet" : unanswered.length || matters[0]?.camel?.health === "sick" ? "unanswered" : concerns ? "attention" : "calm";

  // The answer names the first thing that needs the owner; the rest wait below.
  const top = matters[0] ?? null;
  const healthWord = (health: keyof typeof HEALTH_LABELS) => (locale === "en" ? t(HEALTH_LABELS[health]).toLowerCase() : t(HEALTH_LABELS[health]));
  const answer = !hasReport
    ? o.noUpdate
    : standalone.length
      ? o.answerMissed(worker)
      : top?.camel && (top.camel.health === "sick" || top.camel.health === "watch")
        ? o.answerCamel(top.camel.name, healthWord(top.camel.health))
        : top?.camel
          ? o.answerAbout(top.camel.name)
          : top?.findings.length
            ? o.answerFinding(worker)
            : top
              ? o.answerWaiting(worker)
              : o.answerCalm(worker);
  const more = concerns > 1 ? o.moreBelow(concerns - 1) : null;
  const provenance = reportAt ? (
    <>
      {o.fromReport(worker)} · <time className="ltr-nums" dateTime={reportAt}>{fmt.dateTime(reportAt, dateTime)}</time> · {fmt.relative(reportAt, now)}
      {more ? <> · <span className="font-semibold text-cream">{more}</span></> : null}
    </>
  ) : next ? o.firstReportSub : o.noScheduleSub;

  const callNow = <ReportCallNow ws={ws} worker={worker} now={now} />;
  // Three honest states: no call time yet; a time saved but calling not switched on; a call ahead.
  const nextBlock = (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div className="min-w-0">
        <p className="text-sm text-cream/70">{!next ? d.nextCall : scheduledOff ? d.plannedCall : hasReport ? o.callsWorker(worker) : o.firstCallsWorker(worker)}</p>
        {next ? (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[1.5rem] font-semibold leading-tight sm:text-[1.75rem]">
              <time className="ltr-nums" dateTime={next.toISOString()}>{fmt.dateTime(next, dayTime)}</time>
            </span>
            <span className="text-[0.9375rem] text-cream/75">
              {scheduledOff ? o.callingInactive : <>{fmt.dateTime(next, dayMonth)} · <span className="font-semibold text-gold">{fmt.relative(next, now)}</span></>}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-[1.5rem] font-semibold leading-tight">{o.noCallTimeYet}</p>
        )}
      </div>
      {!next ? (
        <Link href={`${href("/app/settings")}#settings-report-call`} className="naqah-nudge inline-flex min-h-11 items-center gap-1.5 rounded-full border border-cream/35 px-5 text-sm font-semibold text-cream transition hover:bg-cream/10 active:scale-[0.98]">
          {o.setCallTime}
          <ArrowRight size={15} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : null}
      {callNow}
    </div>
  );

  const slots = reportRhythm(ws, now, ws.settings.plan === "basic" ? 6 : 7, 3);
  const showStrip = Boolean(next) || slots.some((slot) => slot.state === "saved" || slot.state === "missed");
  const rhythm = showStrip ? <RhythmStrip slots={slots} weekly={ws.settings.plan === "basic"} now={now} planned={scheduledOff} /> : null;

  const ownerRoute = routeOwnerInboundCall(ws, now);
  const allowanceUsed = ownerAllowanceUsed(ws, now);
  const missedCallbackUsed = ws.calls.some(
    (item) => item.kind === "owner_inquiry" && item.summary.en === "Owner called back after a missed notification" && sameWeek(item.at, now),
  );
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
            <EstateMatters ws={ws} matters={matters} unanswered={unanswered} reportAt={reportAt} worker={worker} now={now} />
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
