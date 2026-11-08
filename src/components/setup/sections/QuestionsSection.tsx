"use client";

import { LockKey, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { Card, CardBody, CardHeader, Field, IconButton, Input, Textarea } from "@/components/ui";
import { PREDEFINED_QUESTIONS, QUESTION_CATEGORY_LABELS, RESOURCE_LABELS } from "@/domain/catalog";
import { uid } from "@/domain/id";
import { applicableQuestions, canAddCustomQuestion, customQuestionLimit } from "@/domain/rules";
import type { QuestionCategory } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { SaveState } from "../SaveState";
import type { SetupSectionProps } from "../types";

export function QuestionsSection({ ws, onChange, showSaved }: SetupSectionProps) {
  const { m, t } = useI18n();
  const [newQuestion, setNewQuestion] = useState("");
  const applicableIds = new Set(applicableQuestions(ws).map((question) => question.id));
  const limit = customQuestionLimit(ws);
  const canAdd = canAddCustomQuestion(ws);
  const categories = [...new Set(PREDEFINED_QUESTIONS.map((question) => question.category))] as QuestionCategory[];

  function addQuestion() {
    const text = newQuestion.trim();
    if (!text || !canAdd) return;
    onChange((current) => ({
      ...current,
      settings: {
        ...current.settings,
        customQuestions: [...current.settings.customQuestions, { id: uid("cq"), text, createdAt: new Date().toISOString() }],
      },
    }));
    setNewQuestion("");
  }

  return (
    <Card>
      <CardHeader
        title={m.onboarding.sectionTitles.questions}
        action={showSaved ? <SaveState /> : undefined}
      />
      <CardBody className="space-y-6">
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-espresso">{m.onboarding.predefinedQuestions}</h3>
            <span className="text-sm text-muted">{m.onboarding.questionsOneAtATime}</span>
          </div>
          <div className="mt-3 space-y-4">
            {categories.map((category) => {
              const questions = PREDEFINED_QUESTIONS.filter((question) => question.category === category);
              if (!questions.length) return null;
              return (
                <section key={category}>
                  <h4 className="mb-2 text-sm font-semibold text-muted">{t(QUESTION_CATEGORY_LABELS[category])}</h4>
                  <ul className="divide-y divide-stone/70 rounded-xl border border-stone/70">
                    {questions.map((question) => {
                      const available = applicableIds.has(question.id);
                      const resourceLabel = question.requires ? t(RESOURCE_LABELS[question.requires]) : "";
                      return (
                        <li key={question.id} className={`flex gap-3 px-3 py-3 sm:px-4 ${available ? "" : "bg-ivory/70 text-muted"}`}>
                          <LockKey className="mt-0.5 shrink-0 text-brown" size={18} aria-label={m.onboarding.lockedQuestion} />
                          <div className="min-w-0">
                            <p className={`leading-relaxed ${available ? "text-espresso" : "text-muted"}`}>{t(question.text)}</p>
                            {!available && question.requires ? (
                              <p className="mt-1 text-xs text-muted">{m.onboarding.skippedBecause(resourceLabel)}</p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-espresso">{m.onboarding.customQuestions}</h3>
            <span className="ltr-nums text-sm font-semibold text-muted">
              {limit === Infinity ? m.onboarding.unlimited : m.onboarding.questionCount(ws.settings.customQuestions.length, limit)}
            </span>
          </div>
          {ws.settings.customQuestions.length ? (
            <ul className="mt-3 space-y-3">
              {ws.settings.customQuestions.map((question, index) => (
                <li key={question.id} className="flex items-start gap-2">
                  <Field label={m.onboarding.questionNumber(index + 1)} className="min-w-0 flex-1">
                    {(id) => (
                      <Textarea
                        id={id}
                        rows={2}
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
                  </Field>
                  <IconButton
                    className="mt-6 h-11 w-11 shrink-0"
                    label={m.onboarding.removeQuestion(index + 1)}
                    onClick={() => onChange((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        customQuestions: current.settings.customQuestions.filter((item) => item.id !== question.id),
                      },
                    }))}
                  >
                    <Trash size={18} aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">{m.onboarding.noCustomQuestions}</p>
          )}
          <div className="mt-4 flex items-end gap-2">
            <Field label={m.onboarding.newQuestion} className="min-w-0 flex-1">
              {(id) => (
                <Input
                  id={id}
                  value={newQuestion}
                  maxLength={300}
                  onChange={(event) => setNewQuestion(event.target.value)}
                  disabled={!canAdd}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addQuestion();
                    }
                  }}
                />
              )}
            </Field>
            <button
              type="button"
              onClick={addQuestion}
              disabled={!newQuestion.trim() || !canAdd}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-stone px-4 text-sm font-semibold text-espresso transition hover:border-sand hover:bg-ivory focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Plus size={18} weight="fill" aria-hidden />
              <span>{m.common.actions.add}</span>
            </button>
          </div>
          {!canAdd ? <p className="mt-2 text-sm text-muted">{m.onboarding.questionLimitReached}</p> : null}
        </section>
      </CardBody>
    </Card>
  );
}
