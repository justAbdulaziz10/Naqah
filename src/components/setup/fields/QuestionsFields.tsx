"use client";

import { CaretDown, CaretUp, Plus, Trash } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Switch } from "@/components/ui";
import { RESOURCE_LABELS } from "@/domain/catalog";
import { callQuestionPlan } from "@/domain/callQuestions";
import { uid } from "@/domain/id";
import {
  canAddCustomQuestion, customQuestionLimit, moveQuestionInPlan, planEntriesFromRows, questionPlanRows, reportModeOf, reportPlanHasContent,
  type QuestionPlanRow,
} from "@/domain/rules";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow } from "@/store/workspace";
import type { SetupFieldsProps } from "../types";
import { StepField, StepInput, wizardControl } from "../onboarding/WizardParts";

const iconButton =
  "inline-flex size-11 items-center justify-center rounded-full text-muted transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:opacity-35";
const moveButton = cn(iconButton, "enabled:hover:bg-espresso/5 enabled:hover:text-espresso");

/**
 * What the next report call asks, in order: one list of NAQAH's questions and the owner's, each
 * switched on or off and moved up or down. The owner adds, edits and removes their own within the
 * plan's limit. Shared by setup and Settings.
 */
export function QuestionsFields({ ws, onChange, headingLevel = 3 }: SetupFieldsProps & { headingLevel?: 2 | 3 }) {
  const { m, t } = useI18n();
  const q = m.setup.questions;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const now = useNow();
  const [draft, setDraft] = useState("");
  // The last removed question, so a slip of the finger can be undone, with its place in the plan.
  const [removed, setRemoved] = useState<{
    question: (typeof ws.settings.customQuestions)[number];
    index: number;
    entry: { id: string; enabled: boolean; required: boolean } | null;
    planIndex: number;
  } | null>(null);
  const [moved, setMoved] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const plan = callQuestionPlan(ws);
  const limit = customQuestionLimit(ws);
  const canAdd = canAddCustomQuestion(ws);
  const questions = ws.settings.customQuestions;
  const planName = m.common.plans[ws.settings.plan];
  const worker = ws.settings.worker.name.trim() || m.setup.call.workerFallback;
  const v = m.visual.script;
  const rows = questionPlanRows(ws).filter((row) => row.applicable);
  const hasContent = reportPlanHasContent(ws, now);
  // Open talk has no order or "must answer": the list is what NAQAH listens for.
  const open = reportModeOf(ws) === "open";

  const setQuestions = (edit: (list: typeof questions) => typeof questions) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, customQuestions: edit(current.settings.customQuestions) } }));

  const setPlan = (edit: (list: QuestionPlanRow[]) => QuestionPlanRow[]) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, questionPlan: planEntriesFromRows(edit(questionPlanRows(current))) } }));

  const setRow = (id: string, patch: { enabled?: boolean; required?: boolean }) =>
    setPlan((list) => list.map((row) => (row.question.id === id ? { ...row, ...patch } : row)));

  const rowElement = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-question="${CSS.escape(id)}"]`);

  function move(id: string, step: -1 | 1) {
    setPlan((list) => moveQuestionInPlan(list, id, step));
    setMoved(rows.findIndex((row) => row.question.id === id) + step + 1);
    setRemoved(null);
    // At either end of the list its own button is disabled, so the other one takes the focus.
    requestAnimationFrame(() => {
      const row = rowElement(id);
      (row?.querySelector<HTMLButtonElement>(`[data-move="${step}"]:not(:disabled)`) ?? row?.querySelector<HTMLButtonElement>("[data-move]:not(:disabled)"))?.focus();
    });
  }

  function add() {
    const text = draft.trim();
    if (!text || !canAdd) return;
    setQuestions((list) => [...list, { id: uid("cq"), text, createdAt: new Date().toISOString() }]);
    setDraft("");
    setRemoved(null);
    setMoved(null);
  }

  function remove(id: string) {
    const index = questions.findIndex((item) => item.id === id);
    if (index < 0) return;
    const question = questions[index];
    const position = rows.filter((row) => row.kind === "custom").findIndex((row) => row.question.id === id);
    const stored = ws.settings.questionPlan ?? [];
    const planIndex = stored.findIndex((entry) => entry.id === id);
    onChange((current) => ({
      ...current,
      settings: {
        ...current.settings,
        customQuestions: current.settings.customQuestions.filter((item) => item.id !== id),
        questionPlan: (current.settings.questionPlan ?? []).filter((entry) => entry.id !== id),
      },
    }));
    setRemoved({ question, index, entry: planIndex >= 0 ? stored[planIndex] : null, planIndex });
    setMoved(null);
    // Focus stays in the list: the question that took its place, the one before it, or the add field.
    requestAnimationFrame(() => {
      const fields = listRef.current?.querySelectorAll<HTMLTextAreaElement>("textarea");
      const next = fields?.[Math.min(position, (fields?.length ?? 0) - 1)];
      (next ?? addRef.current)?.focus();
    });
  }

  function undo() {
    if (!removed) return;
    const { question, index, entry, planIndex } = removed;
    onChange((current) => {
      const { customQuestions, questionPlan = [] } = current.settings;
      if (customQuestions.some((item) => item.id === question.id)) return current;
      return {
        ...current,
        settings: {
          ...current.settings,
          customQuestions: [...customQuestions.slice(0, index), question, ...customQuestions.slice(index)],
          questionPlan: entry ? [...questionPlan.slice(0, planIndex), entry, ...questionPlan.slice(planIndex)] : questionPlan,
        },
      };
    });
    setRemoved(null);
    requestAnimationFrame(() => rowElement(question.id)?.querySelector("textarea")?.focus());
  }

  return (
    <div>
      <Heading className="ps-8 text-[1.0625rem] font-bold text-espresso">{open ? q.openTitle(worker) : v.title(worker)}</Heading>
      <p className="mt-1 ps-8 text-[0.9375rem] leading-relaxed text-muted">
        {open ? q.listNote : <>{q.requiredNote} {q.listNote}</>}
      </p>
      <div className="relative mt-5">
        {/* One line through the whole call, from NAQAH's greeting to its call to the owner. */}
        <span aria-hidden className="absolute -bottom-[2.4rem] start-[5.5px] top-[0.75rem] w-px bg-stone" />
        <div className="relative ps-8">
          <Marker kind="end" />
          <p className="leading-relaxed text-espresso">{v.intro}</p>
        </div>

        <ol ref={listRef} className="mt-4">
          {rows.map((row, index) => (
            <QuestionRow
              key={row.question.id}
              row={row}
              position={index + 1}
              total={rows.length}
              open={open}
              onToggle={(enabled) => setRow(row.question.id, { enabled })}
              onRequired={(required) => setRow(row.question.id, { required })}
              onMove={(step) => move(row.question.id, step)}
              onEdit={(text) => setQuestions((list) => list.map((item) => (item.id === row.question.id ? { ...item, text } : item)))}
              onRemove={() => remove(row.question.id)}
            />
          ))}
        </ol>
        {hasContent ? null : (
          // The wizard's Next button and the Settings guard both focus the first aria-invalid element.
          <p role="alert" className="mt-3 ps-8 text-[0.9375rem] font-semibold text-danger">
            <span tabIndex={-1} aria-invalid="true" className="block scroll-mt-40 outline-none">{q.nothingToAsk}</span>
          </p>
        )}
        {plan.skipped.length ? (
          // NAQAH's questions this ranch can't be asked, by name and with the reason, where the call would be.
          <div className="mt-4">
            <p className="ps-8 text-[0.9375rem] font-semibold text-muted">{q.skippedTitle}</p>
            <ul className="mt-1">
              {plan.skipped.map((item) => (
                <li key={item.question.id} className="relative py-1.5 ps-8">
                  <Marker kind="naqah" muted />
                  <p className="leading-relaxed text-muted">{t(item.question.text)}</p>
                  <p className="text-[0.9375rem] leading-relaxed text-muted">
                    {item.reason === "herd_count" ? q.skippedHerd : q.skippedResource(t(RESOURCE_LABELS[item.resource]))}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

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
          ) : moved ? q.moved(moved) : null}
        </p>
        {canAdd ? (
          <>
            <form
              className="mt-5 flex flex-col gap-3 ps-8 sm:flex-row sm:items-end sm:gap-2"
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
                className="naqah-press inline-flex h-12 shrink-0 items-center justify-center gap-2 self-start rounded-full border border-stone bg-cream px-5 font-semibold text-espresso transition hover:border-sand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:text-muted sm:h-14 sm:self-auto"
              >
                <Plus size={18} weight="bold" aria-hidden />
                {m.common.actions.add}
              </button>
            </form>
            <p className="mt-2 ps-8 text-[0.9375rem] text-muted">
              {Number.isFinite(limit) ? q.left(planName, limit, Math.max(0, limit - questions.length)) : q.unlimited}
            </p>
          </>
        ) : (
          <p className="mt-5 ps-8 text-[0.9375rem] text-muted">{q.limitReached(limit)}</p>
        )}

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

function QuestionRow({ row, position, total, open, onToggle, onRequired, onMove, onEdit, onRemove }: {
  row: QuestionPlanRow;
  open: boolean;
  position: number;
  total: number;
  onToggle: (enabled: boolean) => void;
  onRequired: (required: boolean) => void;
  onMove: (step: -1 | 1) => void;
  onEdit: (text: string) => void;
  onRemove: () => void;
}) {
  const { m, t } = useI18n();
  const q = m.setup.questions;
  const text = row.kind === "custom" ? row.question.text : t(row.question.text);
  // Said on the question, not on the checkbox: "Must answer · optional" would contradict itself.
  const optional = row.enabled && !row.required && !open;
  const custom = row.kind === "custom";
  return (
    <li data-question={row.question.id} className="relative py-3 ps-8">
      <Marker kind={custom ? "owner" : "naqah"} muted={!row.enabled} className={custom ? "top-[2.125rem]!" : "top-[1.45rem]!"} />
      {/* Phone: question and switch, then "must answer" and the order buttons. Wider: order buttons beside the switch. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        {custom ? (
          <StepField label={<span className="sr-only">{q.question(position)}</span>} hint={optional ? q.optional : undefined} className="col-start-1 row-start-1 min-w-0 gap-0">
            {({ id }) => (
              <textarea
                id={id}
                dir="auto"
                rows={1}
                maxLength={300}
                className={cn(wizardControl, "h-auto min-h-14 resize-none py-3.5 leading-relaxed [field-sizing:content]", !row.enabled && "text-muted!")}
                value={row.question.text}
                onChange={(event) => onEdit(event.target.value)}
              />
            )}
          </StepField>
        ) : (
          <p className={cn("col-start-1 row-start-1 min-w-0 pt-1 leading-relaxed", row.enabled ? "text-espresso" : "text-muted")}>
            {text}
            {optional ? <span className="block text-[0.9375rem] text-muted">{q.optional}</span> : null}
          </p>
        )}
        <Switch
          checked={row.enabled}
          onChange={onToggle}
          label={q.ask(position, text)}
          className={cn("col-start-2 row-start-1 sm:col-start-3", custom ? "mt-3.5" : "mt-1")}
        />
        <div className="col-start-1 row-start-2 -mt-1 min-w-0">
          {open && row.enabled ? null : row.enabled ? (
            <label className="-ms-1 inline-flex min-h-11 cursor-pointer items-center gap-2 px-1 text-[0.9375rem]">
              <input type="checkbox" checked={row.required} onChange={(event) => onRequired(event.target.checked)} className="size-[1.125rem] shrink-0 accent-brown" />
              <span className={row.required ? "font-medium text-espresso" : "text-muted"}>
                {q.mustAnswer}<span className="sr-only"> · {q.nth(position)}</span>
              </span>
            </label>
          ) : (
            <span className="inline-flex min-h-11 items-center text-[0.9375rem] text-muted">{q.off}</span>
          )}
        </div>
        <div className={cn("col-start-2 row-start-2 -me-2 flex items-center justify-end sm:row-start-1 sm:me-0", custom ? "sm:mt-1.5" : "sm:-mb-2 sm:-mt-1.5")}>
          <button type="button" data-move="-1" aria-label={q.moveUp(position)} title={q.moveUp(position)} disabled={position === 1} onClick={() => onMove(-1)} className={moveButton}>
            <CaretUp size={18} aria-hidden />
          </button>
          <button type="button" data-move="1" aria-label={q.moveDown(position)} title={q.moveDown(position)} disabled={position === total} onClick={() => onMove(1)} className={moveButton}>
            <CaretDown size={18} aria-hidden />
          </button>
          {custom ? (
            <button type="button" aria-label={q.remove(position)} title={q.remove(position)} onClick={onRemove} className={cn(iconButton, "hover:bg-danger-soft hover:text-danger")}>
              <Trash size={18} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Rail marks: open rings where the call starts and ends, brown for NAQAH's questions, gold for the owner's. */
function Marker({ kind, muted, className }: { kind: "end" | "naqah" | "owner"; muted?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute start-0 rounded-full",
        kind === "end" && "top-[0.4rem] size-3 border-2 border-brown bg-cream",
        kind === "naqah" && cn("start-[2px] top-[1.15rem] size-2", muted ? "bg-stone" : "bg-brown"),
        kind === "owner" && cn("start-[1.5px] top-[1.5rem] size-2.5", muted ? "bg-stone" : "bg-gold"),
        className,
      )}
    />
  );
}
