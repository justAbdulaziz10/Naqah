"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ArrowRight, Check, CheckCircle, Minus, WarningCircle, X } from "@phosphor-icons/react";
import { EmptyState, OutcomeBadge } from "@/components/dashboard/DashboardPrimitives";
import { GroupLabel, PageHeader } from "@/components/dashboard/PageHeader";
import { ReportSheet } from "@/components/dashboard/ReportSheet";
import { callEntries, type CallChain, type CallGroup, type ReportStory } from "@/components/dashboard/callStories";
import { useHashTarget } from "@/components/dashboard/useHashTarget";
import { CALL_ATTEMPTS } from "@/components/dashboard/callStatus";
import { callKindLabel } from "@/components/dashboard/callLabels";
import { AttemptDots, type AttemptMark } from "@/components/visuals/AttemptDots";
import { useCallSentence } from "@/components/schedule/ReportCallSection";
import { useScheduledCallsOn } from "@/components/schedule/useScheduledCalls";
import { CallActivity } from "@/components/visuals/CallActivity";
import { ReportFlow, type FlowStep } from "@/components/visuals/ReportFlow";
import { Button, ButtonLink, Card, Segmented } from "@/components/ui";
import { latestReportCall } from "@/domain";
import type { CallLog, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useIsAccount, useNow, useWorkspace } from "@/store/workspace";
import { CALL_HISTORY_PAGE_DAYS, pageCallEntries } from "@/components/calls/paging";

type CallFilter = "all" | CallGroup;

const attemptMark = (call: CallLog): AttemptMark => (call.outcome === "no_answer" ? "no_answer" : call.outcome === "rejected" ? "rejected" : call.party === "worker" ? "answered" : "owner");

function Direction({ call, worker }: { call: CallLog; worker: string }) {
  const { m } = useI18n();
  const v = m.visual.calls;
  const other = call.party === "worker" ? worker : v.you;
  const [from, to] = call.direction === "inbound" ? [other, v.naqah] : [v.naqah, other];
  return (
    <span className="inline-flex items-center gap-1.5">
      {/* One sentence for screen readers ("NAQAH to Ahmed"); the arrow form is for the eye. */}
      <span className="sr-only">{v.direction(from, to)}</span>
      <span aria-hidden>{from}</span>
      <ArrowRight size={12} weight="bold" className="shrink-0 rtl:-scale-x-100" aria-hidden />
      <span aria-hidden>{to}</span>
    </span>
  );
}

/** Whether a call connected, as a shape: a tick in a disc, a cross in an amber ring, a dash in grey. */
function OutcomeMark({ outcome }: { outcome: CallLog["outcome"] }) {
  if (outcome === "completed") {
    return <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brown text-cream"><Check size={15} weight="bold" /></span>;
  }
  if (outcome === "no_answer") {
    return <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-warn text-warn"><X size={14} weight="bold" /></span>;
  }
  return <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-faint text-muted"><Minus size={14} weight="bold" /></span>;
}

function ViewReport({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const { m } = useI18n();
  return (
    <Button variant="secondary" size="sm" className={cn("naqah-nudge h-11 shrink-0", className)} onClick={onOpen} aria-haspopup="dialog">
      {m.app.calls.viewReport}
      <ArrowRight size={15} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
    </Button>
  );
}

function StoryRow({ story, worker, onOpen }: { story: ReportStory; worker: string; onOpen: () => void }) {
  const { m, t, fmt } = useI18n();
  const v = m.visual.calls;
  const c = m.app.calls;
  const report = story.report;
  const findings = report?.findings ?? [];
  const briefing = story.briefings.find((call) => call.outcome === "completed") ?? story.briefings.at(-1);
  const steps: FlowStep[] = [
    { key: "worker", title: worker, detail: <>{report?.answers.length ? v.answeredQuestions(report.answers.length) : v.answered} · <time className="ltr-nums" dateTime={story.call.at}>{fmt.time(story.call.at)}</time></>, state: "done" },
    { key: "naqah", title: v.naqah, detail: report ? <>{v.saved} · {v.findings(findings.length)}</> : v.saved, state: "done" },
    briefing?.outcome === "completed"
      ? { key: "owner", title: v.you, detail: v.briefed(fmt.time(briefing.at)), state: "done" }
      : briefing
        ? { key: "owner", title: v.you, detail: v.briefMissed, state: "missed" }
        : { key: "owner", title: v.you, detail: v.briefPending, state: "waiting" },
  ];
  const delivery = story.deliveries.at(-1);
  if (delivery) {
    const done = delivery.find((call) => call.outcome === "completed");
    steps.push(done
      ? { key: "back", title: worker, detail: v.delivered(fmt.time(done.at)), state: "done" }
      : { key: "back", title: worker, detail: delivery.length >= CALL_ATTEMPTS ? v.deliveryFailed : v.deliveryMissed, state: "missed" });
  }

  return (
    <article data-hash-target={report ? `report-${report.id}` : undefined} tabIndex={-1} className="flex gap-4 px-5 py-6 transition-colors duration-200 hover:bg-ivory/50 focus:outline-none sm:px-7">
      <OutcomeMark outcome={story.call.outcome} />
      <div className="min-w-0 flex-1">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-[0.8125rem] font-medium text-muted">
            <time className="ltr-nums" dateTime={story.call.at}>{fmt.time(story.call.at)}</time>
            <span aria-hidden>·</span>
            <Direction call={story.call} worker={worker} />
          </p>
          <h3 className="naqah-name mt-1 text-[1.375rem] font-semibold leading-snug tracking-[-0.01em] text-espresso">{c.reportOf(worker)}</h3>
          {findings.length ? (
            <p className="mt-2 flex items-start gap-2 leading-relaxed text-espresso">
              <WarningCircle size={18} weight="fill" className="mt-1 shrink-0 text-warn" aria-hidden />
              <span><bdi>{t(findings[0].text)}</bdi>{findings.length > 1 ? <span className="text-muted"> · {c.moreFindings(findings.length - 1)}</span> : null}</span>
            </p>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-muted">
              <CheckCircle size={18} weight="fill" className="shrink-0 text-ok" aria-hidden />
              {c.noFindings}
            </p>
          )}
        </div>
        {report ? <ViewReport onOpen={onOpen} className="max-sm:hidden" /> : null}
      </div>
      <ReportFlow stack steps={steps} label={v.flowLabel(worker)} className="mt-5 max-w-2xl" />
      {/* On a phone the story reads top to bottom, so the way into the report closes it. */}
      {report ? <ViewReport onOpen={onOpen} className="mt-5 w-full sm:hidden" /> : null}
      </div>
    </article>
  );
}

function ChainRow({ ws, chain, worker }: { ws: Workspace; chain: CallChain; worker: string }) {
  const { m, t, fmt } = useI18n();
  const c = m.app.calls;
  const last = chain.calls[chain.calls.length - 1];
  const answered = chain.calls.find((call) => call.outcome === "completed");
  const many = chain.calls.length > 1;
  const carried = last.kind === "worker_instruction" || last.kind === "worker_task_verification";
  const task = last.ticketId ? ws.taskTickets.find((ticket) => ticket.id === last.ticketId) ?? null : null;
  return (
    <div className="flex gap-4 px-5 py-5 transition-colors duration-200 hover:bg-ivory/50 sm:px-7">
      <OutcomeMark outcome={answered ? "completed" : last.outcome} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-[0.8125rem] font-medium text-muted">
          <time className="ltr-nums" dateTime={last.at}>{fmt.time(last.at)}</time>
          <span aria-hidden>·</span>
          <Direction call={last} worker={worker} />
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-[1.0625rem] font-semibold text-espresso">{callKindLabel(last.kind, m)}</h3>
          {many ? null : <OutcomeBadge outcome={last.outcome} />}
        </div>
        {/* A follow-up names its task in the owner's words; otherwise the call's own summary. */}
        <p className="mt-0.5 text-sm leading-relaxed text-espresso">{task ? task.instruction : t((answered ?? last).summary)}</p>
        {many ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <AttemptDots marks={chain.calls.map(attemptMark)} label={m.visual.tasks.attempts(fmt.number(chain.calls.length))} />
            <span className={answered ? "text-muted" : "font-semibold text-warn"}>
              {answered
                ? c.answeredOn(fmt.number(answered.attempt ?? chain.calls.indexOf(answered) + 1))
                : carried && chain.calls.length >= CALL_ATTEMPTS
                  ? c.notDeliveredAfter(fmt.number(chain.calls.length))
                  : c.attemptsNoAnswer(fmt.number(chain.calls.length))}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EmptyCalls({ ws, worker, account }: { ws: Workspace; worker: string; account: boolean }) {
  const { m, fmt, href } = useI18n();
  const firstCall = useCallSentence(ws);
  // A saved time is only a promise once this deployment places scheduled calls.
  const scheduledOff = useScheduledCallsOn() === false && account;
  const v = m.visual.calls;
  // An answered call that ended early leaves no call log, but it did happen.
  const endedEarly = latestReportCall(ws)?.state === "missed";
  return (
    <Card className="px-5 py-10 sm:px-10 sm:py-12">
      <p className="text-center text-xl font-semibold text-espresso">{endedEarly ? m.app.calls.noReportYet : m.app.calls.empty}</p>
      <p className="mx-auto mt-1 max-w-md text-center text-muted">{endedEarly ? m.app.calls.noReportYetBody : m.app.calls.emptyBody}</p>
      <ReportFlow
        stack
        className="mx-auto mt-8 w-full max-w-xl"
        label={v.flowLabel(worker)}
        steps={[
          { key: "worker", title: v.emptyAnswer(worker), detail: scheduledOff && firstCall ? m.app.overview.callingInactive : firstCall ? v.emptyAnswerDetail(fmt.dateTime(firstCall.next, { weekday: "short", day: undefined, month: undefined })) : v.emptyAnswerUnset, state: "waiting" },
          { key: "naqah", title: v.emptySave, detail: v.emptySaveDetail, state: "waiting" },
          { key: "owner", title: v.emptyBrief, detail: v.emptyBriefDetail, state: "waiting" },
        ]}
      />
      {account ? null : (
        <div className="mt-8 flex justify-center">
          <ButtonLink href={href("/app/lab")} variant="secondary">{m.app.overview.simulateCall}</ButtonLink>
        </div>
      )}
    </Card>
  );
}

export default function CallsPage() {
  const { m, fmt } = useI18n();
  const c = m.app.calls;
  const ws = useWorkspace();
  const now = useNow();
  const account = useIsAccount();
  const [filter, setFilter] = useState<CallFilter>("all");
  const [visibleDayCount, setVisibleDayCount] = useState(CALL_HISTORY_PAGE_DAYS);
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const linked = useHashTarget("report-", Boolean(ws));

  // A link to one report (from the Overview) opens it once; closing it clears the link.
  const [seenLink, setSeenLink] = useState<string | null>(null);
  if (linked !== seenLink) {
    setSeenLink(linked);
    if (linked) setOpenReportId(linked);
  }

  const entries = useMemo(() => (ws ? callEntries(ws) : []), [ws]);
  const { days, hasEarlier } = useMemo(
    () => pageCallEntries(entries, filter, visibleDayCount),
    [entries, filter, visibleDayCount],
  );

  if (!ws) return null;
  const worker = ws.settings.worker.name.trim() || m.app.overview.unnamedWorker;
  const openReport = openReportId ? ws.reports.find((report) => report.id === openReportId) ?? null : null;

  function closeReport() {
    setOpenReportId(null);
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  return (
    <div className="naqah-page space-y-6 pb-8">
      <PageHeader
        title={c.title}
        lead={c.lead}
        action={ws.calls.length ? (
          <Segmented
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setVisibleDayCount(CALL_HISTORY_PAGE_DAYS);
            }}
            label={c.filterLabel}
            className="w-full [&>button]:flex-1 sm:w-auto sm:[&>button]:flex-none"
            options={[
              { value: "all", label: c.all },
              { value: "reports", label: c.reports },
              ...(ws.settings.plan === "ultimate" ? [{ value: "followUps" as const, label: c.followUps }] : []),
              { value: "yours", label: c.yours },
            ]}
          />
        ) : null}
      />

      {ws.calls.length ? (
        <>
          <Card className="px-5 py-4 sm:px-7">
            <CallActivity calls={ws.calls} now={now} />
          </Card>

          {days.length ? (
            <div className="space-y-7">
              <div id="calls-history" className="space-y-7">
                {days.map(([day, group]) => (
                  <section key={day} aria-labelledby={`calls-day-${day}`}>
                    <GroupLabel id={`calls-day-${day}`}>{fmt.date(group[0].at)}</GroupLabel>
                    <Card className="naqah-stagger divide-y divide-stone/70 overflow-hidden">
                      {group.map((entry, index) => (
                        <div key={entry.id} style={{ "--i": index } as CSSProperties}>
                          {entry.type === "report"
                            ? <StoryRow story={entry} worker={worker} onOpen={() => entry.report && setOpenReportId(entry.report.id)} />
                            : <ChainRow ws={ws} chain={entry} worker={worker} />}
                        </div>
                      ))}
                    </Card>
                  </section>
                ))}
              </div>
              {hasEarlier ? (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-11"
                    aria-controls="calls-history"
                    onClick={() => setVisibleDayCount((count) => count + CALL_HISTORY_PAGE_DAYS)}
                  >
                    {c.showEarlier}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <Card><EmptyState title={c.emptyFilter} /></Card>
          )}
        </>
      ) : <EmptyCalls ws={ws} worker={worker} account={account} />}

      {openReport ? <ReportSheet ws={ws} report={openReport} worker={worker} onClose={closeReport} /> : null}
    </div>
  );
}
