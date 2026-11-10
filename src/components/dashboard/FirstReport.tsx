"use client";

import Link from "next/link";
import { plannedQuestions, type Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { Step } from "./EstateMatters";

/**
 * Before the first report: how a report reaches the owner. The header already says when the first
 * call is, so the steps say what happens, not when. Nothing here claims a call has taken place.
 */
export function FirstReport({ ws, worker }: { ws: Workspace; worker: string }) {
  const { m, href } = useI18n();
  const o = m.app.overview;
  const questions = plannedQuestions(ws).length;

  return (
    <section aria-labelledby="first-report" className="naqah-rise rounded-[var(--radius-card)] border border-stone/70 bg-cream px-5 py-6 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <h2 id="first-report" className="text-xl font-semibold leading-snug text-espresso">{o.firstReportTitle}</h2>
          <p className="mt-1 text-muted">{o.firstReportLead}</p>
        </div>
        <Link href={`${href("/app/settings")}#settings-questions`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
          {o.reviewQuestions}
        </Link>
      </div>
      <ol className="mt-5 flex min-w-0 flex-col md:flex-row">
        <Step title={o.firstCallStep(worker)} detail={o.firstCallDetail} waiting />
        <Step title={o.askStep} detail={questions ? o.askCount(questions) : null} waiting />
        <Step title={o.callsYouStep} detail={o.callsYouDetail} last waiting />
      </ol>
    </section>
  );
}
