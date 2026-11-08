"use client";

import Link from "next/link";
import { applicableQuestions, type Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { Step } from "./EstateMatters";

const dateTime = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } as const;

/** Before the first report: what will happen, and when. Nothing here claims a call has taken place. */
export function FirstReport({ ws, worker, next }: { ws: Workspace; worker: string; next: Date | null }) {
  const { m, fmt, href } = useI18n();
  const o = m.app.overview;
  const questions = applicableQuestions(ws).length + ws.settings.customQuestions.length;

  return (
    <section aria-labelledby="first-report" className="naqah-rise rounded-[var(--radius-card)] border border-stone/70 bg-cream px-5 py-5 sm:px-8 sm:py-6">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4">
        <h2 id="first-report" className="text-lg font-semibold text-espresso">{o.firstReportTitle}</h2>
        <Link href={`${href("/app/settings")}#settings-questions`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
          {o.reviewQuestions}
        </Link>
      </div>
      <ol className="mt-4 flex min-w-0 flex-col md:flex-row">
        <Step
          title={o.firstCallStep(worker)}
          detail={next ? fmt.dateTime(next, dateTime) : o.firstCallUnset}
          waiting
        />
        <Step title={o.askStep} detail={questions ? o.askCount(questions) : null} waiting />
        <Step title={o.callsYouStep} detail={o.callsYouDetail} last waiting />
      </ol>
    </section>
  );
}
