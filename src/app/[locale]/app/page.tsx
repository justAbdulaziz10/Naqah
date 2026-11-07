"use client";

import { Card } from "@/components/ui";
import { EmptyState } from "@/components/dashboard/DashboardPrimitives";
import { EstateHeader, type EstateFact, type EstateTone } from "@/components/dashboard/EstateHeader";
import { EstateLedger } from "@/components/dashboard/EstateLedger";
import { EstateMatters } from "@/components/dashboard/EstateMatters";
import { HerdCountFact } from "@/components/dashboard/HerdCountFact";
import { ReportCallNow } from "@/components/dashboard/ReportCallNow";
import { estateMatters } from "@/components/dashboard/matters";
import { useCallSentence } from "@/components/schedule/ReportCallSection";
import { lastReportAt, openNoAnswerTickets, openTaskTickets, ownerAllowanceUsed, routeOwnerInboundCall, sameWeek } from "@/domain";
import { useI18n } from "@/i18n/client";
import { CallSetupStatus, getCallSetupGaps } from "@/components/setup";
import { useNow, useWorkspace } from "@/store/workspace";

const dateTime = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } as const;

export default function OverviewPage() {
  const { m, fmt, href } = useI18n();
  const app = m.app;
  const d = m.setup.dashboard;
  const ws = useWorkspace();
  const now = useNow();
  const call = useCallSentence(ws);
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
  // One next step: finish what calls need, then follow open tasks, otherwise the herd.
  const action = gaps.length
    ? { href: href("/app/settings"), label: m.setup.gaps.title }
    : tasks.length
      ? { href: href("/app/tickets"), label: app.overview.viewTickets }
      : { href: href("/app/herd"), label: app.overview.viewHerd };

  const ownerRoute = routeOwnerInboundCall(ws, now);
  const allowanceUsed = ownerAllowanceUsed(ws, now);
  const missedCallbackUsed = ws.calls.some(
    (item) => item.kind === "owner_inquiry" && item.summary.en === "Owner called back after a missed notification" && sameWeek(item.at, now),
  );

  const facts: EstateFact[] = [];
  if (reportAt) {
    facts.push({
      key: "last",
      label: app.overview.lastUpdateLabel,
      content: (
        <>
          <p className="text-lg font-semibold leading-snug">{fmt.relative(reportAt, now)}</p>
          <p className="mt-1 text-sm text-cream/75">
            <time className="ltr-nums" dateTime={reportAt}>{fmt.dateTime(reportAt, dateTime)}</time>
            <span> · {app.overview.reportedBy(worker)}</span>
          </p>
        </>
      ),
    });
  }
  facts.push({
    key: "next",
    label: d.nextCall,
    content: call ? (
      <>
        <p className="text-lg font-semibold leading-snug">
          <time className="ltr-nums" dateTime={call.next.toISOString()}>{fmt.dateTime(call.next, dateTime)}</time>
        </p>
        <p className="mt-1 text-sm text-cream/75">{d.callsWorker(call.worker)} · {fmt.relative(call.next, now)}</p>
        <ReportCallNow ws={ws} worker={worker} now={now} />
      </>
    ) : (
      <>
        <p className="text-lg font-semibold leading-snug">{d.noCallTime}</p>
        <ReportCallNow ws={ws} worker={worker} now={now} />
      </>
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
      <EstateHeader name={estateName} state={state} tone={tone} action={action} facts={facts} />

      <CallSetupStatus ws={ws} />

      {hasReport ? (
        <EstateMatters ws={ws} matters={matters} unanswered={unanswered} reportAt={reportAt} worker={worker} now={now} />
      ) : (
        <Card>
          <EmptyState camel title={app.overview.firstReportTitle} body={app.overview.firstReportBody} />
        </Card>
      )}

      {hasReport || ws.camels.length > 0 ? (
        <EstateLedger ws={ws} worker={worker} now={now} hasReport={hasReport} allowance={allowance} />
      ) : null}
    </div>
  );
}
