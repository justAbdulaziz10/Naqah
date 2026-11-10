"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { WORKER_LANGUAGES } from "@/domain/catalog";
import { isHerdCount } from "@/domain/herd";
import type { Settings, Worker } from "@/domain/types";
import { allWorkers, canAddWorker, newWorker, withWorkerIds, workerLimit, workersOverLimit } from "@/domain/workers";
import { useI18n } from "@/i18n/client";
import { isLiveCallLanguage } from "@/lib/voice/liveCallLanguages";
import { latinDigits } from "@/lib/supabase/auth-input";
import type { SetupFieldsProps } from "../types";
import { FieldGroup, PhoneField, StepField, StepInput, StepSelect } from "../onboarding/WizardParts";

/**
 * Puts the list back as primary + others, each with an id. Unlike `setWorkers` it never drops a row:
 * a farm over its plan's limit keeps every worker until the owner removes one.
 */
function placeWorkers<T extends Pick<Settings, "worker" | "otherWorkers">>(settings: T, list: Worker[], primary = 0): T {
  const index = primary >= 0 && primary < list.length ? primary : 0;
  return withWorkerIds({ ...settings, worker: list[index], otherWorkers: list.filter((_, i) => i !== index) });
}

/** Parses what the owner typed; Arabic digits count. Blank clears the count. */
function parseHerdCount(text: string): number | null | undefined {
  const value = latinDigits(text).trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const count = Number(value);
  return isHerdCount(count) ? count : undefined;
}

/** Registered workers (one is called for the report) and the official herd count. */
export function TeamFields({ ws, onChange, showErrors = false }: SetupFieldsProps) {
  const { m, t } = useI18n();
  const s = m.setup.team;
  const workers = allWorkers(ws.settings);
  const limit = workerLimit(ws.settings.plan);
  const over = workersOverLimit(ws.settings);
  const [herdText, setHerdText] = useState<string | null>(null);
  const herdCount = ws.settings.herdCount ?? null;
  const herdValue = herdText ?? (herdCount === null ? "" : String(herdCount));
  const herdInvalid = herdText !== null;

  const editList = (edit: (list: Worker[]) => Worker[], primary = 0) =>
    onChange((current) => ({ ...current, settings: placeWorkers(current.settings, edit(allWorkers(current.settings)), primary) }));
  const editWorker = (index: number, patch: Partial<Worker>) =>
    editList((list) => list.map((worker, i) => (i === index ? { ...worker, ...patch } : worker)));

  const languageOption = (language: (typeof WORKER_LANGUAGES)[number]) => (
    <option key={language.id} value={language.id}>
      {language.native === t(language.label) ? language.native : `${language.native} · ${t(language.label)}`}
    </option>
  );
  const liveLanguages = WORKER_LANGUAGES.filter((language) => isLiveCallLanguage(language.id));
  const laterLanguages = WORKER_LANGUAGES.filter((language) => !isLiveCallLanguage(language.id));

  const many = workers.length > 1;
  const optional = <span className="font-normal text-muted"> ({m.setup.ranch.optional})</span>;

  return (
    <div className="space-y-10">
      <FieldGroup title={s.workers}>
        <ul className="divide-y divide-stone/80 border-y border-stone/80">
          {workers.map((worker, index) => {
            const label = worker.name.trim() || s.worker(index + 1);
            const language = WORKER_LANGUAGES.find((item) => item.id === worker.language) ?? WORKER_LANGUAGES[0];
            const primary = index === 0;
            return (
              <li key={worker.id ?? `worker-${index}`} className="py-5">
                <fieldset className="min-w-0">
                  <legend className="sr-only">{label}</legend>
                  {many ? (
                    <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
                      <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3">
                        {/* 44px tap area around the 20px radio; the negative margin keeps it in place. */}
                        <span className="-mx-3 inline-flex size-11 shrink-0 items-center justify-center">
                          <input
                            type="radio"
                            name="primary-worker"
                            checked={primary}
                            onChange={() => editList((list) => list, index)}
                            className="size-5 shrink-0 accent-brown"
                          />
                        </span>
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                          <span className="min-w-0 break-words text-[1.0625rem] font-semibold text-espresso">{label}</span>
                          <span className={primary ? "text-[0.9375rem] font-medium leading-5 text-brown" : "sr-only"}>{s.primary}</span>
                        </span>
                      </label>
                      <button
                        type="button"
                        aria-label={s.remove(label)}
                        title={s.remove(label)}
                        onClick={() => editList((list) => list.filter((_, i) => i !== index))}
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash size={20} aria-hidden />
                      </button>
                    </div>
                  ) : null}
                  <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
                    <StepField label={s.name} error={primary && showErrors && !worker.name.trim() ? m.setup.call.needWorkerName : undefined}>
                      {({ id, describedBy, invalid }) => (
                        <StepInput
                          id={id}
                          dir="auto"
                          autoComplete="off"
                          aria-describedby={describedBy}
                          aria-invalid={invalid || undefined}
                          className={invalid ? "border-danger" : undefined}
                          value={worker.name}
                          onChange={(event) => editWorker(index, { name: event.target.value })}
                        />
                      )}
                    </StepField>
                    <PhoneField
                      label={s.phone}
                      autoComplete="off"
                      value={worker.phone}
                      showError={showErrors}
                      requiredMessage={primary ? m.setup.call.needWorkerPhone : undefined}
                      onChange={(phone) => editWorker(index, { phone })}
                    />
                  </div>
                  {/* The call language is rarely changed, so it waits behind its current value. */}
                  <details className="group mt-3" open={!isLiveCallLanguage(worker.language) || undefined}>
                    <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[0.9375rem] text-muted transition-colors hover:text-espresso [&::-webkit-details-marker]:hidden">
                      {s.callsIn(language.native)}
                      <span className="font-semibold text-brown underline decoration-sand underline-offset-4 group-open:hidden">{s.changeLanguage}</span>
                    </summary>
                    <div className="mt-2 sm:max-w-[calc(50%-0.625rem)]">
                        <StepField
                          label={s.language}
                          hint={isLiveCallLanguage(worker.language) ? undefined : s.languageLater(t(language.label))}
                        >
                          {({ id, describedBy }) => (
                            <StepSelect
                              id={id}
                              aria-describedby={describedBy}
                              value={worker.language}
                              onChange={(event) => editWorker(index, { language: event.target.value as Worker["language"] })}
                            >
                              <optgroup label={s.liveLanguages}>{liveLanguages.map(languageOption)}</optgroup>
                              <optgroup label={s.laterLanguages}>{laterLanguages.map(languageOption)}</optgroup>
                            </StepSelect>
                          )}
                        </StepField>
                    </div>
                  </details>
                </fieldset>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            disabled={!canAddWorker(ws.settings)}
            onClick={() => editList((list) => [...list, newWorker(list[0]?.language ?? "ar")])}
            className="inline-flex min-h-12 items-center gap-2 rounded-full border border-stone bg-cream px-5 font-semibold text-espresso transition hover:border-sand disabled:cursor-not-allowed disabled:text-muted"
          >
            <Plus size={18} weight="bold" aria-hidden />
            {s.add}
          </button>
          <p className="text-[0.9375rem] text-muted">{s.limit(limit, m.common.plans[ws.settings.plan])}</p>
        </div>
        {/* Setup's Next button focuses the first aria-invalid element, so this message takes the focus. */}
        {over ? (
          <p className="mt-3 text-[0.9375rem] text-danger" role="alert">
            <span tabIndex={-1} aria-invalid="true" className="block scroll-mt-40 outline-none">{s.overLimit(over)}</span>
          </p>
        ) : null}
      </FieldGroup>

      <FieldGroup title={s.herd}>
        <StepField
          label={<>{s.herdCount}{optional}</>}
          className="sm:max-w-[calc(50%-0.625rem)]"
          hint={s.herdHint}
          error={herdInvalid ? s.herdInvalid : undefined}
        >
          {({ id, describedBy }) => (
            <StepInput
              id={id}
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              className="ltr-nums text-start"
              aria-describedby={describedBy}
              aria-invalid={herdInvalid || undefined}
              value={herdValue}
              onChange={(event) => {
                const parsed = parseHerdCount(event.target.value);
                if (parsed === undefined) return setHerdText(event.target.value);
                setHerdText(null);
                onChange((current) => ({ ...current, settings: { ...current.settings, herdCount: parsed } }));
              }}
            />
          )}
        </StepField>
      </FieldGroup>
    </div>
  );
}
