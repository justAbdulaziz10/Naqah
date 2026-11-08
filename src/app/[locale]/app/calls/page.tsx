"use client";

import { useMemo, useState } from "react";
import { ArrowsClockwise, PhoneIncoming, PhoneOutgoing, WarningCircle } from "@phosphor-icons/react";
import { EmptyState, OutcomeBadge } from "@/components/dashboard/DashboardPrimitives";
import { ReportAnswers } from "@/components/dashboard/ReportAnswers";
import { ButtonLink, Card, CardBody, Segmented } from "@/components/ui";
import { dayKey } from "@/domain";
import type { CallKind, CallLog } from "@/domain";
import { useI18n } from "@/i18n/client";
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

function CallMarker({ call }: { call: CallLog }) {
  if (call.kind === "worker_report_rejected" || call.kind === "owner_inquiry_rejected") {
    return <WarningCircle size={21} weight="fill" className="text-warn" aria-hidden />;
  }
  if (call.kind === "worker_callback") {
    return <ArrowsClockwise size={21} weight="fill" className="text-info" aria-hidden />;
  }
  const Icon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  const color = call.outcome === "no_answer" ? "text-warn" : call.party === "worker" ? "text-info" : "text-brown";
  return <Icon size={21} weight="fill" className={color} aria-hidden />;
}

export default function CallsPage() {
  const { m, t, fmt, href } = useI18n();
  const ws = useWorkspace();
  const account = useIsAccount();
  const [filter, setFilter] = useState<CallFilter>("all");

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
              <h2 id={`calls-day-${day}`} className="mb-3 text-sm font-bold text-muted">{fmt.date(group[0].at)}</h2>
              <Card>
              <ul className="divide-y divide-stone/70">
                {group.map((call) => {
                  const report = call.reportId ? ws.reports.find((item) => item.id === call.reportId) : null;
                  // One report, one place for its details: the worker's report call when it is listed.
                  const showDetails = Boolean(call.reportId) && (call.kind === "worker_report" || !calls.some((other) => other.reportId === call.reportId && other.kind === "worker_report"));
                  return (
                    <li key={call.id}>
                        <CardBody className="py-4">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 shrink-0">
                              <CallMarker call={call} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                                <h3 className="font-semibold text-espresso">{callTitle(call.kind, m)}</h3>
                                <OutcomeBadge outcome={call.outcome} />
                                {call.attempt !== null && call.attempt > 1 ? <span className="text-xs text-muted">{m.app.calls.attempt(fmt.number(call.attempt))}</span> : null}
                              </div>
                              <p className="mt-1 text-[0.8125rem] text-muted"><time className="ltr-nums" dateTime={call.at}>{fmt.time(call.at)}</time></p>
                              <p className="mt-2 text-sm leading-relaxed text-espresso">{t(call.summary)}</p>

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
                            </div>
                          </div>
                        </CardBody>
                    </li>
                  );
                })}
              </ul>
              </Card>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          {ws.calls.length === 0 ? (
            <EmptyState
              camel
              title={m.app.calls.empty}
              body={account ? m.app.calls.emptyBody : undefined}
              action={account ? undefined : <ButtonLink href={href("/app/lab")} variant="secondary">{m.app.overview.simulateCall}</ButtonLink>}
            />
          ) : <EmptyState title={m.app.calls.empty} />}
        </Card>
      )}

      {ws.calls.length ? <p className="text-[0.8125rem] text-muted">{m.app.calls.note}</p> : null}
    </div>
  );
}
