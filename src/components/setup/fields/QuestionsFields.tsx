"use client";

import { CaretDown, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { PREDEFINED_QUESTIONS, RESOURCE_LABELS } from "@/domain/catalog";
import { uid } from "@/domain/id";
import { applicableQuestions, canAddCustomQuestion, customQuestionLimit } from "@/domain/rules";
import { useI18n } from "@/i18n/client";
import type { SetupFieldsProps } from "../types";
import { StepField, StepInput } from "../onboarding/WizardParts";

/** The owner's own questions. NAQAH's questions are automatic: one line, with the list behind a disclosure. */
export function QuestionsFields({ ws, onChange }: SetupFieldsProps) {
  const { m, t } = useI18n();
  const q = m.setup.questions;
  const [draft, setDraft] = useState("");
  const applicable = new Set(applicableQuestions(ws).map((question) => question.id));
  const limit = customQuestionLimit(ws);
  const canAdd = canAddCustomQuestion(ws);
  const questions = ws.settings.customQuestions;

  function add() {
    const text = draft.trim();
    if (!text || !canAdd) return;
    onChange((current) => ({
      ...current,
      settings: {
        ...current.settings,
        customQuestions: [...current.settings.customQuestions, { id: uid("cq"), text, createdAt: new Date().toISOString() }],
      },
    }));
    setDraft("");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="max-w-[52ch] text-[1.0625rem] leading-relaxed text-espresso">{q.automatic}</p>
        <details className="group mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-semibold text-brown underline decoration-sand underline-offset-4 hover:decoration-brown [&::-webkit-details-marker]:hidden">
            {q.showAutomatic(applicable.size)}
            <CaretDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-2 divide-y divide-stone/70 border-y border-stone/70">
            {PREDEFINED_QUESTIONS.map((question) => {
              const asked = applicable.has(question.id);
              return (
                <li key={question.id} className="py-2.5 leading-relaxed">
                  <p className={asked ? "text-espresso" : "text-muted"}>{t(question.text)}</p>
                  {!asked && question.requires ? <p className="text-sm text-muted">{q.skipped(t(RESOURCE_LABELS[question.requires]))}</p> : null}
                </li>
              );
            })}
          </ul>
        </details>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[1.0625rem] font-bold text-espresso">{q.yours}</h3>
          <span className="text-[0.9375rem] text-muted">{limit === Infinity ? q.unlimited : q.count(questions.length, limit)}</span>
        </div>
        {questions.length ? (
          <ul className="mt-3 space-y-3">
            {questions.map((question, index) => (
              <li key={question.id} className="flex items-end gap-2">
                <StepField label={<span className="sr-only">{q.question(index + 1)}</span>} className="min-w-0 flex-1 gap-0">
                  {({ id }) => (
                    <StepInput
                      id={id}
                      dir="auto"
                      maxLength={300}
                      value={question.text}
                      onChange={(event) => onChange((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          customQuestions: current.settings.customQuestions.map((item) => item.id === question.id ? { ...item, text: event.target.value } : item),
                        },
                      }))}
                    />
                  )}
                </StepField>
                <button
                  type="button"
                  aria-label={q.remove(index + 1)}
                  title={q.remove(index + 1)}
                  onClick={() => onChange((current) => ({
                    ...current,
                    settings: { ...current.settings, customQuestions: current.settings.customQuestions.filter((item) => item.id !== question.id) },
                  }))}
                  className="inline-flex size-14 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-danger-soft hover:text-danger"
                >
                  <Trash size={20} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {canAdd ? (
          <form
            className="mt-4 flex items-end gap-2"
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
              className="inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-full border border-stone bg-white px-5 font-semibold text-espresso transition hover:border-sand disabled:cursor-not-allowed disabled:text-muted"
            >
              <Plus size={18} weight="bold" aria-hidden />
              {m.common.actions.add}
            </button>
          </form>
        ) : (
          <p className="mt-3 text-[0.9375rem] text-muted">{q.limitReached}</p>
        )}
      </div>
    </div>
  );
}
