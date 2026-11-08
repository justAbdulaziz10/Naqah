"use client";

import { Badge } from "@/components/ui";
import type { ReportAnswer } from "@/domain";
import { useI18n } from "@/i18n/client";
import { CertaintyBadge } from "./DashboardPrimitives";

/** Question and answer as the worker gave it, with how sure it is. Fixed choices read in the owner's language. */
export function ReportAnswers({ answers }: { answers: ReportAnswer[] }) {
  const { m, t } = useI18n();
  return (
    <dl className="divide-y divide-stone/70">
      {answers.map((answer, index) => (
        <div key={`${answer.questionId}-${index}`} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-4">
          <dt className="text-sm text-muted">{t(answer.question)}</dt>
          <dd className="text-sm font-medium leading-relaxed text-espresso">
            <span>{answer.answerText ? t(answer.answerText) : answer.answer}</span>
            <span className="ms-2 inline-flex align-middle"><CertaintyBadge certainty={answer.certainty} /></span>
            {answer.followUp ? <span className="ms-2 inline-flex align-middle"><Badge tone="info">{m.app.calls.followUp}</Badge></span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
