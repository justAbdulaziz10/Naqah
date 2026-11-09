"use client";

import { ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { SupplyGauges } from "@/components/visuals/SupplyGauges";
import type { FarmReport, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { CertaintyBadge } from "./DashboardPrimitives";
import { callEntries } from "./callStories";
import { mentions } from "./matters";
import { ReportCoverage } from "./ReportCoverage";
import { reportResources } from "./reportCoverageFacts";

const row = "grid grid-cols-1 py-4 sm:grid-cols-[4.5rem_6.5rem_minmax(0,1fr)] sm:gap-x-5";

function Line({ at, who, whoTone = "text-espresso", index, children }: { at?: string | null; who: string; whoTone?: string; index: number; children: ReactNode }) {
  const { fmt } = useI18n();
  return (
    <li className={cn(row, "naqah-stagger-item border-t border-stone/70 first:border-t-0")} style={{ "--i": index } as CSSProperties}>
      <span className="pt-0.5 text-[0.8125rem] tabular-nums text-muted max-sm:hidden">{at ? <time className="ltr-nums" dateTime={at}>{fmt.time(at)}</time> : null}</span>
      <span className={cn("pt-px text-sm font-semibold max-sm:hidden", whoTone)}>{who}</span>
      <div className="min-w-0">
        {/* Phones: who and when share one line above the content. */}
        <span className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-sm sm:hidden">
          <span className={cn("naqah-name font-semibold", whoTone)}>{who}</span>
          {at ? <time className="ltr-nums text-[0.8125rem] text-muted" dateTime={at}>{fmt.time(at)}</time> : null}
        </span>
        {children}
      </div>
    </li>
  );
}

/**
 * The latest report set as the call it came from, in the landing's ledger: what the worker said to
 * the owner's questions, what NAQAH flagged, the supplies as reported, then NAQAH's call to the owner
 * and the instruction passed back. Provenance stays quiet: only estimates and unknowns are marked.
 */
export function ReportLedger({ ws, report, worker }: { ws: Workspace; report: FarmReport; worker: string }) {
  const { m, t, fmt, href } = useI18n();
  const o = m.app.overview;
  const c = m.app.calls;
  const story = callEntries(ws).find((entry) => entry.type === "report" && entry.report?.id === report.id);
  const briefing = story?.type === "report" ? story.briefings.find((call) => call.outcome === "completed") ?? story.briefings.at(-1) ?? null : null;
  const delivery = story?.type === "report" && ws.settings.plan === "ultimate" ? story.deliveries.at(-1)?.find((call) => call.outcome === "completed") ?? null : null;
  const custom = new Set(ws.settings.customQuestions.map((question) => question.id));
  const answers = report.answers.filter((answer) => custom.has(answer.questionId) && !answer.followUp && report.coverage?.find((entry) => entry.questionId === answer.questionId)?.status !== "not_reported");
  const supplies = reportResources(ws, report);
  // Findings are told in full under "Needs your attention"; here they are indexed by camel where one is named.
  const flagged = report.findings.map((finding) => {
    const camel = ws.camels.find((item) => mentions(finding.text.ar, item.name) || mentions(finding.text.en, item.name));
    return { id: finding.id, camel, text: t(finding.text) };
  });
  let index = 0;

  return (
    <section aria-labelledby="report-ledger" className="naqah-rise rounded-[var(--radius-card)] border border-stone/70 bg-cream px-5 pb-3 pt-6 sm:px-8 sm:pt-7">
      <figure className="border-t-2 border-espresso">
        <figcaption className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 pb-3 pt-4">
          <div className="min-w-0">
            <h2 id="report-ledger" className="naqah-name text-2xl font-semibold leading-tight tracking-[-0.01em] text-espresso">{o.reportTitle(worker)}</h2>
            <p className="mt-1 text-sm text-muted">{o.reportNote}</p>
          </div>
          <p className="text-sm font-medium text-espresso">
            <time className="ltr-nums" dateTime={report.at}>{fmt.dateTime(report.at, { weekday: "long", day: "numeric", month: "short", hour: undefined, minute: undefined })}</time>
            {report.mode ? <span className="font-normal text-muted"> · {o.reportMode[report.mode]}</span> : null}
          </p>
        </figcaption>
        <ReportCoverage ws={ws} report={report} />
        <ol className="border-t border-stone/70">
          {answers.length ? (
            <Line at={report.at} who={worker} index={index++}>
              <dl className="space-y-3">
                {answers.map((answer, i) => (
                  <div key={`${answer.questionId}-${i}`}>
                    <dt className="text-sm leading-relaxed text-muted">{t(answer.question)}</dt>
                    <dd className="text-[1.0625rem] font-semibold leading-relaxed text-espresso">
                      {answer.answerText ? t(answer.answerText) : answer.answer}
                      {answer.certainty !== "reported" ? <span className="ms-2 font-normal"><CertaintyBadge certainty={answer.certainty} /></span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </Line>
          ) : null}
          <Line at={answers.length ? null : report.at} who={flagged.length ? o.flagged : o.nothingFlaggedShort} whoTone={flagged.length ? "text-warn" : "text-ok"} index={index++}>
            {flagged.length ? (
              <ul className="space-y-1.5">
                {flagged.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 leading-relaxed text-espresso">
                    <WarningCircle size={17} weight="fill" className="mt-1 shrink-0 text-warn" aria-hidden />
                    {item.camel ? (
                      <Link href={`${href("/app/herd")}#camel-${item.camel.id}`} className="naqah-name -my-2.5 inline-block py-2.5 font-semibold underline decoration-stone underline-offset-4 hover:decoration-brown">
                        {item.camel.name}
                      </Link>
                    ) : <span>{item.text}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 leading-relaxed text-espresso">
                <CheckCircle size={17} weight="fill" className="shrink-0 text-ok" aria-hidden />
                {o.nothingFlagged}
              </p>
            )}
          </Line>
          {supplies.length ? (
            <Line who={o.resources} index={index++}>
              <SupplyGauges resources={supplies} />
            </Line>
          ) : null}
          <Line at={briefing?.at ?? null} who={m.visual.calls.naqah} whoTone="text-brown" index={index++}>
            <p className={cn("flex items-center gap-2.5 font-semibold", briefing?.outcome === "completed" ? "text-brown" : briefing ? "text-warn" : "text-muted")}>
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", briefing?.outcome === "completed" ? "bg-brown" : briefing ? "border-2 border-warn" : "border-2 border-stone")} />
              {briefing?.outcome === "completed" ? o.briefedYou : briefing ? o.briefMissed : o.briefPending}
            </p>
          </Line>
          {delivery ? (
            <Line at={delivery.at} who={worker} index={index++}>
              <p className="leading-relaxed text-espresso">{o.gotInstruction}</p>
            </Line>
          ) : null}
        </ol>
      </figure>
      <div className="border-t border-stone/70 py-2">
        <Link href={`${href("/app/calls")}#report-${report.id}`} className="naqah-nudge inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
          {c.viewReport}
          <ArrowRight size={15} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
