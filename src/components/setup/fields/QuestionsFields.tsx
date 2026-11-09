"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useRef, useState } from "react";
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
export function QuestionsFields({ ws, onChange, headingLevel = 3 }: SetupFieldsProps & { headingLevel?: 2 | 3 }) {
  const { m, t } = useI18n();
  const q = m.setup.questions;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const [draft, setDraft] = useState("");
  // The last removed question, so a slip of the finger can be undone.
  const [removed, setRemoved] = useState<{ question: (typeof ws.settings.customQuestions)[number]; index: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const plan = callQuestionPlan(ws);
  const limit = customQuestionLimit(ws);
  const canAdd = canAddCustomQuestion(ws);
  const questions = ws.settings.customQuestions;
  const planName = m.common.plans[ws.settings.plan];
  const worker = ws.settings.worker.name.trim() || m.setup.call.workerFallback;
  const v = m.visual.script;

  const setQuestions = (edit: (list: typeof questions) => typeof questions) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, customQuestions: edit(current.settings.customQuestions) } }));

  function add() {
    const text = draft.trim();
    if (!text || !canAdd) return;
    setQuestions((list) => [...list, { id: uid("cq"), text, createdAt: new Date().toISOString() }]);
    setDraft("");
    setRemoved(null);
  }

  function remove(index: number) {
    const question = questions[index];
    setQuestions((list) => list.filter((item) => item.id !== question.id));
    setRemoved({ question, index });
    // Focus stays in the list: the question that took its place, the one before it, or the add field.
    requestAnimationFrame(() => {
      const fields = listRef.current?.querySelectorAll<HTMLTextAreaElement>("textarea");
      const next = fields?.[Math.min(index, (fields?.length ?? 0) - 1)];
      (next ?? addRef.current)?.focus();
    });
  }

  function undo() {
    if (!removed) return;
    const { question, index } = removed;
    setQuestions((list) => (list.some((item) => item.id === question.id) ? list : [...list.slice(0, index), question, ...list.slice(index)]));
    setRemoved(null);
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLTextAreaElement>("textarea")[index]?.focus());
  }

  return (
    <div>
      <p className="ps-8 text-[1.0625rem] text-muted">{v.title(worker)}</p>
      <div className="relative mt-4">
        {/* One line through the whole call, from NAQAH's greeting to its call to the owner. */}
        <span aria-hidden className="absolute -bottom-[2.4rem] start-[5.5px] top-[0.75rem] w-px bg-stone" />
        <div className="relative ps-8">
          <Marker kind="end" />
          <p className="leading-relaxed text-espresso">{v.intro}</p>
          <p className="mt-0.5 text-[0.9375rem] text-muted">{v.introDetail}</p>
        </div>

        <section aria-labelledby="naqah-questions" className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ps-8">
            <Heading id="naqah-questions" className="text-[1.0625rem] font-bold text-espresso">{q.naqah}</Heading>
            <span className="text-[0.9375rem] text-muted">{q.naqahNote}</span>
          </div>
          <ol className="mt-2">
            {plan.asked.map((question) => (
              <li key={question.id} className="relative py-2.5 ps-8 leading-relaxed text-espresso">
                <Marker kind="naqah" />
                {t(question.text)}
              </li>
            ))}
          </ol>
          {plan.skipped.length ? (
            <ul className="mt-2 space-y-1 ps-8 text-[0.9375rem] leading-relaxed text-muted">
              {plan.skipped.map((item) => (
                <li key={item.question.id}>
                  {item.reason === "herd_count" ? q.skippedHerd : q.skippedResource(t(RESOURCE_LABELS[item.resource]))}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section aria-labelledby="owner-questions" className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ps-8">
            <Heading id="owner-questions" className="text-[1.0625rem] font-bold text-espresso">{q.yours}</Heading>
            <span className="ltr-nums text-[0.9375rem] text-muted">
              {Number.isFinite(limit) ? q.left(planName, limit, Math.max(0, limit - questions.length)) : q.unlimited}
            </span>
          </div>
          {questions.length ? (
            <ol ref={listRef} className="mt-3 space-y-3">
              {questions.map((question, index) => (
                <li key={question.id} className="relative flex items-start gap-2 ps-8">
                  <Marker kind="owner" />
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
                    onClick={() => remove(index)}
                    className="inline-flex size-14 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash size={20} aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 ps-8 text-[0.9375rem] text-muted">{q.yoursNote}</p>
          )}
          <p role="status" className={removed ? "mt-3 flex flex-wrap items-center gap-x-3 ps-8 text-[0.9375rem] text-espresso" : "sr-only"}>
            {removed ? (
              <>
                <span className="naqah-saved-in">{q.removed}</span>
                <button
                  type="button"
                  onClick={undo}
                  className="inline-flex min-h-11 items-center font-semibold text-brown underline decoration-sand underline-offset-4 hover:decoration-brown"
                >
                  {q.undo}
                </button>
              </>
            ) : null}
          </p>
          {canAdd ? (
            <form
              className="mt-4 flex flex-col gap-3 ps-8 sm:flex-row sm:items-end sm:gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                add();
              }}
            >
              <StepField label={q.newQuestion} className="min-w-0 flex-1">
                {({ id }) => <StepInput ref={addRef} id={id} dir="auto" maxLength={300} value={draft} placeholder={q.placeholder} onChange={(event) => setDraft(event.target.value)} />}
              </StepField>
              <button
                type="submit"
                disabled={!draft.trim()}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 self-start rounded-full border border-stone bg-cream px-5 font-semibold text-espresso transition hover:border-sand disabled:cursor-not-allowed disabled:text-muted sm:h-14 sm:self-auto"
              >
                <Plus size={18} weight="bold" aria-hidden />
                {m.common.actions.add}
              </button>
            </form>
          ) : (
            <p className="mt-3 ps-8 text-[0.9375rem] text-muted">{q.limitReached(limit)}</p>
          )}
        </section>

        {plan.checksTasks ? (
          <div className="relative mt-8 ps-8">
            <Marker kind="naqah" />
            <p className="leading-relaxed text-espresso">{v.tasks}</p>
          </div>
        ) : null}
      </div>
      <div className="relative mt-8 ps-8">
        <Marker kind="end" />
        <p className="font-semibold leading-relaxed text-espresso">{v.outro}</p>
        <p className="mt-0.5 text-[0.9375rem] text-muted">{v.outroDetail}</p>
      </div>
    </div>
  );
}

/** Rail marks: open rings where the call starts and ends, brown for NAQAH's questions, gold for the owner's. */
function Marker({ kind }: { kind: "end" | "naqah" | "owner" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute start-0 rounded-full",
        kind === "end" && "top-[0.4rem] size-3 border-2 border-brown bg-cream",
        kind === "naqah" && "start-[2px] top-[1.15rem] size-2 bg-brown",
        kind === "owner" && "start-[1.5px] top-[1.5rem] size-2.5 bg-gold",
      )}
    />
  );
}
