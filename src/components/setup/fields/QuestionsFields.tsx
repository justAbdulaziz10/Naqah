"use client";

import { Check, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { RESOURCE_LABELS } from "@/domain/catalog";
import { callQuestionPlan } from "@/domain/callQuestions";
import { uid } from "@/domain/id";
import { canAddCustomQuestion, customQuestionLimit } from "@/domain/rules";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import type { SetupFieldsProps } from "../types";
import { StepField, StepInput, wizardControl } from "../onboarding/WizardParts";

/**
 * What the next report call asks, in order: NAQAH's own questions (always asked, listed openly),
 * then the owner's, which they add, edit and remove within the plan's limit. Shared by setup and Settings.
 */
export function QuestionsFields({ ws, onChange }: SetupFieldsProps) {
  const { m, t } = useI18n();
  const q = m.setup.questions;
  const [draft, setDraft] = useState("");
  const plan = callQuestionPlan(ws);
  const limit = customQuestionLimit(ws);
  const canAdd = canAddCustomQuestion(ws);
  const questions = ws.settings.customQuestions;
  const planName = m.common.plans[ws.settings.plan];
  const worker = ws.settings.worker.name.trim() || m.setup.call.workerFallback;

  const setQuestions = (edit: (list: typeof questions) => typeof questions) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, customQuestions: edit(current.settings.customQuestions) } }));

  function add() {
    const text = draft.trim();
    if (!text || !canAdd) return;
    setQuestions((list) => [...list, { id: uid("cq"), text, createdAt: new Date().toISOString() }]);
    setDraft("");
  }

  return (
    <div className="space-y-8">
      <p className="max-w-[52ch] text-[1.0625rem] leading-relaxed text-muted">{q.lead(worker)}</p>

      <section aria-labelledby="naqah-questions">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="naqah-questions" className="text-[1.0625rem] font-bold text-espresso">{q.naqah}</h3>
          <span className="text-[0.9375rem] text-muted">{q.naqahNote}</span>
        </div>
        <ol className="mt-3 divide-y divide-stone/70 border-y border-stone/70">
          {plan.asked.map((question) => (
            <li key={question.id} className="flex items-start gap-3 py-3 leading-relaxed text-espresso">
              <Check size={18} weight="bold" className="mt-1 shrink-0 text-brown" aria-hidden />
              <span>{t(question.text)}</span>
            </li>
          ))}
        </ol>
        {plan.skipped.length ? (
          <ul className="mt-3 space-y-1 text-[0.9375rem] leading-relaxed text-muted">
            {plan.skipped.map((item) => (
              <li key={item.question.id}>
                {item.reason === "herd_count" ? q.skippedHerd : q.skippedResource(t(RESOURCE_LABELS[item.resource]))}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="owner-questions">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="owner-questions" className="text-[1.0625rem] font-bold text-espresso">{q.yours}</h3>
          <span className="ltr-nums text-[0.9375rem] text-muted">
            {Number.isFinite(limit) ? q.left(planName, limit, Math.max(0, limit - questions.length)) : q.unlimited}
          </span>
        </div>
        {questions.length ? (
          <ol className="mt-3 space-y-3">
            {questions.map((question, index) => (
              <li key={question.id} className="flex items-start gap-2">
                <StepField label={<span className="sr-only">{q.question(index + 1)}</span>} className="min-w-0 flex-1 gap-0">
                  {({ id }) => (
                    <textarea
                      id={id}
                      dir="auto"
                      rows={1}
                      maxLength={300}
                      className={cn(wizardControl, "h-auto min-h-14 resize-none py-3.5 leading-relaxed [field-sizing:content]")}
                      value={question.text}
                      onChange={(event) => {
                        const text = event.target.value;
                        setQuestions((list) => list.map((item) => (item.id === question.id ? { ...item, text } : item)));
                      }}
                    />
                  )}
                </StepField>
                <button
                  type="button"
                  aria-label={q.remove(index + 1)}
                  title={q.remove(index + 1)}
                  onClick={() => setQuestions((list) => list.filter((item) => item.id !== question.id))}
                  className="inline-flex size-14 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-danger-soft hover:text-danger"
                >
                  <Trash size={20} aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-[0.9375rem] text-muted">{q.yoursNote}</p>
        )}
        {canAdd ? (
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <StepField label={q.newQuestion} className="min-w-0 flex-1">
              {({ id }) => <StepInput id={id} dir="auto" maxLength={300} value={draft} placeholder={q.placeholder} onChange={(event) => setDraft(event.target.value)} />}
            </StepField>
            <button
              type="submit"
              disabled={!draft.trim()}
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 self-start rounded-full border border-stone bg-white px-5 font-semibold text-espresso transition hover:border-sand disabled:cursor-not-allowed disabled:text-muted sm:h-14 sm:self-auto"
            >
              <Plus size={18} weight="bold" aria-hidden />
              {m.common.actions.add}
            </button>
          </form>
        ) : (
          <p className="mt-3 text-[0.9375rem] text-muted">{q.limitReached(limit)}</p>
        )}
        {plan.checksTasks ? <p className="mt-4 text-[0.9375rem] text-muted">{q.tasks}</p> : null}
      </section>
    </div>
  );
}
