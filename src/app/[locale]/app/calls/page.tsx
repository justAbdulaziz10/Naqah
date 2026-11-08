"use client";

import { useMemo, useState } from "react";
import { ArrowRight, WarningCircle } from "@phosphor-icons/react";
import { EmptyState, OutcomeBadge } from "@/components/dashboard/DashboardPrimitives";
import { ReportAnswers } from "@/components/dashboard/ReportAnswers";
import { useCallSentence } from "@/components/schedule/ReportCallSection";
import { ReportFlow, type FlowStep } from "@/components/visuals/ReportFlow";
import { ButtonLink, Card, Segmented } from "@/components/ui";
import { dayKey } from "@/domain";
import type { CallKind, CallLog, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useIsAccount, useWorkspace } from "@/store/workspace";

type CallFilter = "all" | "worker" | "owner";

function callTitle(kind: CallKind, m: ReturnType<typeof useI18n>["m"]) {
  const labels: Record<CallKind, string> = {
    worker_report: m.app.calls.workerReport,
    worker_report_rejected: m.app.calls.rejectedReport,
    worker_report_missed: m.app.calls.missedReport,
    worker_callback: m.app.calls.workerCallback,
    worker_instruction: m.app.calls.instructionDelivery,
    worker_task_verification: m.app.calls.taskVerification,
    owner_notification: m.app.calls.ownerBriefing,
    owner_inquiry: m.app.calls.ownerInquiry,
    owner_inquiry_rejected: m.app.calls.inquiryDeclined,
  };
  return labels[kind];
}

/** The rail mark: who was on the other end, and whether it connected. Words beside it say the same. */
function markClass(call: CallLog) {
  if (call.outcome === "no_answer") return "border-2 border-warn bg-cream";
  if (call.outcome === "rejected") return "border-2 border-faint bg-cream";
  return call.party === "worker" ? "bg-info" : "bg-brown";
}

function Direction({ call, worker }: { call: CallLog; worker: string }) {
  const { m } = useI18n();
  const v = m.visual.calls;
  const other = call.party === "worker" ? worker : v.you;
  const [from, to] = call.direction === "inbound" ? [other, v.naqah] : [v.naqah, other];
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={v.direction(from, to)}>
      <span aria-hidden>{from}</span>
      <ArrowRight size={13} weight="bold" className="shrink-0 rtl:-scale-x-100" aria-hidden />
      <span aria-hidden>{to}</span>
    </span>
  );
}

/** For a worker's report: did it reach NAQAH, and did NAQAH reach the owner afterwards. */
function ReportPath({ ws, call, worker }: { ws: Workspace; call: CallLog; worker: string }) {
  const { m, fmt } = useI18n();
  const v = m.visual.calls;
  const report = ws.reports.find((item) => item.id === call.reportId);
  if (!report) return null;
  const briefing = ws.calls
    .filter((item) => item.kind === "owner_notification" && item.reportId === report.id)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const steps: FlowStep[] = [
    { key: "worker", title: worker, detail: <>{v.answered} · <time className="ltr-nums" dateTime={call.at}>{fmt.time(call.at)}</time></>, state: "done" },
    { key: "naqah", title: v.naqah, detail: <>{v.saved} · {v.findings(report.findings.length)}</>, state: "done" },
    briefing?.outcome === "completed"
      ? { key: "owner", title: v.you, detail: v.briefed(fmt.time(briefing.at)), state: "done" }
      : briefing
        ? { key: "owner", title: v.you, detail: v.briefMissed, state: "missed" }
        : { key: "owner", title: v.you, detail: v.briefPending, state: "waiting" },
  ];
  return <ReportFlow steps={steps} label={v.flowLabel(worker)} className="mt-3 max-w-lg" />;
}

export default function CallsPage() {
  const { m, t, fmt, href } = useI18n();
  const ws = useWorkspace();
  const account = useIsAccount();
  const [filter, setFilter] = useState<CallFilter>("all");
  const firstCall = useCallSentence(ws);

  const calls = useMemo(() => {
    if (!ws) return [];
    return [...ws.calls]
      .filter((call) => filter === "all" || call.party === filter)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [filter, ws]);

  const days = useMemo(() => {
    const groups = new Map<string, CallLog[]>();
    for (const call of calls) {
      const key = dayKey(new Date(call.at));
      groups.set(key, [...(groups.get(key) ?? []), call]);
    }
    return [...groups.entries()];
  }, [calls]);

  if (!ws) return null;
  const worker = ws.settings.worker.name.trim() || m.app.overview.unnamedWorker;

  return (
    <div className="max-w-3xl space-y-5 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-bold text-espresso sm:text-[1.8rem]">{m.app.calls.title}</h1>
        {ws.calls.length ? <Segmented
          value={filter}
          onChange={setFilter}
          label={m.app.calls.filterLabel}
          className="w-full justify-between [&>button]:min-h-11 sm:w-auto sm:justify-start"
          options={[
            { value: "all", label: m.app.calls.all },
            { value: "worker", label: m.app.calls.worker },
            { value: "owner", label: m.app.calls.owner },
          ]}
        /> : null}
      </header>

      {calls.length ? (
        <div className="space-y-6">
          {days.map(([day, group]) => (
            <section key={day} aria-labelledby={`calls-day-${day}`}>
              <h2 id={`calls-day-${day}`} className="mb-3 flex items-baseline gap-2 text-sm font-bold text-espresso">
                {fmt.date(group[0].at)}
                <span className="font-medium text-muted">{m.visual.calls.dayCount(fmt.number(group.length))}</span>
              </h2>
              <Card>
                <ol className="py-2">
                  {group.map((call, index) => {
                    const report = call.reportId ? ws.reports.find((item) => item.id === call.reportId) : null;
                    // One report, one place for its details: the worker's report call when it is listed.
                    const showDetails = Boolean(call.reportId) && (call.kind === "worker_report" || !calls.some((other) => other.reportId === call.reportId && other.kind === "worker_report"));
                    const first = index === 0;
                    const last = index === group.length - 1;
                    return (
                      <li key={call.id} className="relative py-4 pe-5 ps-11 sm:pe-6 sm:ps-[7.75rem]">
                        <span className="absolute start-6 top-[1.05rem] hidden w-[4.1rem] text-sm font-medium text-muted sm:block">
                          <time className="ltr-nums" dateTime={call.at}>{fmt.time(call.at)}</time>
                        </span>
                        <span
                          aria-hidden
                          className="absolute start-[1.59rem] w-px bg-stone sm:start-[6.34rem]"
                          style={{ top: first ? "1.75rem" : 0, bottom: last ? "calc(100% - 1.75rem)" : 0 }}
                        />
                        <span aria-hidden className={cn("absolute start-5 top-[1.375rem] size-3 rounded-full sm:start-[6rem]", markClass(call))} />
                        <p className="flex flex-wrap items-center gap-x-2 text-[0.8125rem] font-medium text-muted">
                          <Direction call={call} worker={worker} />
                          <span className="sm:hidden" aria-hidden>·</span>
                          <time className="ltr-nums sm:hidden" dateTime={call.at}>{fmt.time(call.at)}</time>
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="font-semibold text-espresso">{callTitle(call.kind, m)}</h3>
                          <OutcomeBadge outcome={call.outcome} />
                          {call.attempt !== null && call.attempt > 1 ? <span className="text-xs text-muted">{m.app.calls.attempt(fmt.number(call.attempt))}</span> : null}
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-espresso">{t(call.summary)}</p>
                        {call.kind === "worker_report" && call.reportId ? <ReportPath ws={ws} call={call} worker={worker} /> : null}

                        {showDetails ? (
                          <details className="mt-3 border-t border-stone/70 pt-2">
                            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brown underline decoration-stone underline-offset-4">
                              {m.app.calls.details}
                            </summary>
                            {report ? (
                              <div className="space-y-4 pb-2 pt-1">
                                <section>
                                  <h4 className="mb-2 text-sm font-semibold">{m.app.calls.answers}</h4>
                                  {report.answers.length ? <ReportAnswers answers={report.answers} /> : <p className="text-sm text-muted">{m.app.calls.noAnswers}</p>}
                                </section>
                                <section>
                                  <h4 className="mb-2 text-sm font-semibold">{m.app.calls.findings}</h4>
                                  {report.findings.length ? (
                                    <ul className="space-y-2">
                                      {report.findings.map((finding) => (
                                        <li key={finding.id} className="flex items-start gap-2 text-sm leading-relaxed text-warn">
                                          <WarningCircle size={17} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
                                          <span>{t(finding.text)}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : <p className="text-sm text-muted">{m.app.calls.noFindings}</p>}
                                </section>
                              </div>
                            ) : <p className="pb-2 text-sm text-muted">{m.app.calls.reportUnavailable}</p>}
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          {ws.calls.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center sm:px-8">
              <p className="font-semibold text-espresso">{m.app.calls.empty}</p>
              {account ? <p className="max-w-md text-sm text-muted">{m.app.calls.emptyBody}</p> : null}
              <ReportFlow
                className="mt-5 w-full max-w-xl text-start"
                label={m.visual.calls.flowLabel(worker)}
                steps={[
                  { key: "worker", title: m.visual.calls.emptyAnswer(worker), detail: firstCall ? m.visual.calls.emptyAnswerDetail(fmt.dateTime(firstCall.next, { weekday: "short", day: undefined, month: undefined })) : m.visual.calls.emptyAnswerUnset, state: "waiting" },
                  { key: "naqah", title: m.visual.calls.emptySave, detail: m.visual.calls.emptySaveDetail, state: "waiting" },
                  { key: "owner", title: m.visual.calls.emptyBrief, detail: m.visual.calls.emptyBriefDetail, state: "waiting" },
                ]}
              />
              {account ? null : <ButtonLink href={href("/app/lab")} variant="secondary" className="mt-6">{m.app.overview.simulateCall}</ButtonLink>}
            </div>
          ) : <EmptyState title={m.app.calls.empty} />}
        </Card>
      )}

      {ws.calls.length ? <p className="text-[0.8125rem] text-muted">{m.app.calls.note}</p> : null}
    </div>
  );
}
