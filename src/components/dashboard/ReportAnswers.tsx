"use client";

import type { ReportAnswer } from "@/domain";
import { useI18n } from "@/i18n/client";
import { CertaintyBadge } from "./DashboardPrimitives";

/**
 * Question and answer as the worker gave it. Fixed choices read in the owner's language. Every
 * answer is the worker's report, which the surrounding section says once, so certainty only shows
 * where it differs: an estimate, an unknown, or a fact the owner verified.
 */
export function ReportAnswers({ answers }: { answers: ReportAnswer[] }) {
  const { m, t } = useI18n();
  return (
    <dl className="divide-y divide-stone/70">
      {answers.map((answer, index) => (
        <div key={`${answer.questionId}-${index}`} className="py-3 first:pt-0 last:pb-0">
          <dt className="text-sm leading-relaxed text-muted">
            {answer.followUp ? <span className="font-semibold">{m.app.calls.followUp} · </span> : null}
            {t(answer.question)}
          </dt>
          <dd className="mt-0.5 font-semibold leading-relaxed text-espresso">
            <span>{answer.answerText ? t(answer.answerText) : answer.answer}</span>
            {answer.certainty !== "reported" ? <span className="ms-2 inline-flex align-baseline font-normal"><CertaintyBadge certainty={answer.certainty} /></span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
