"use client";

import { CheckCircle, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { WORKER_LANGUAGES } from "@/domain/catalog";
import { isHerdCount } from "@/domain/herd";
import type { Settings, Worker } from "@/domain/types";
import { allWorkers, canAddWorker, newWorker, withWorkerIds, workerLimit, workersOverLimit } from "@/domain/workers";
import { useI18n } from "@/i18n/client";
import { isLiveCallLanguage } from "@/lib/voice/liveCallLanguages";
import { latinDigits } from "@/lib/supabase/auth-input";
import type { SetupFieldsProps } from "../types";
import { formatSaudiMobile, isSaudiMobile } from "../phone";
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
/** Local demo build: the owner approves a number for test calls themselves, with its owner's agreement. */
const OWNER_APPROVES_NUMBERS = process.env.NEXT_PUBLIC_NAQAH_OWNER_APPROVES_NUMBERS === "1";

/**
 * Settings: a saved worker's number changes only after the owner sees the whole new number once and confirms it,
 * so a half-typed number is never saved and never called. The next call reads it from the ranch as saved.
 */
export function ConfirmedPhone({ label, name, value, onSave }: { label: string; name: string; value: string; onSave: (phone: string) => void }) {
  const { m } = useI18n();
  const s = m.setup.team;
  const [draft, setDraft] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const button = "naqah-press inline-flex min-h-11 items-center rounded-full px-5 font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown";
  if (draft === null) {
    return (
      <div>
        <p className="mb-2 text-[0.9375rem] font-semibold text-espresso">{label}</p>
        <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2">
          <span dir="ltr" className="ltr-nums text-[1.0625rem] text-espresso">{value ? formatSaudiMobile(value) : "—"}</span>
          <button type="button" onClick={() => { setDraft(value); setSaved(false); setConsent(false); setFailed(null); }} className="min-h-11 font-semibold text-brown underline decoration-sand underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown">
            {s.phoneChange}
          </button>
        </div>
        {saved ? (
          <p role="status" className="mt-1 flex items-start gap-1.5 text-[0.9375rem] font-medium text-ok">
            <CheckCircle size={18} weight="fill" className="naqah-done mt-0.5 shrink-0" aria-hidden />
            {s.phoneSaved}
          </p>
        ) : null}
      </div>
    );
  }
  const valid = isSaudiMobile(draft);
  const cancel = () => { setDraft(null); setChecking(false); setFailed(null); };
  /** Local demo: the number is approved for test calls (with the agreement ticked) before it is saved. */
  const confirm = async () => {
    const phone = formatSaudiMobile(draft);
    if (OWNER_APPROVES_NUMBERS) {
      setBusy(true);
      setFailed(null);
      try {
        const response = await fetch("/api/test-number", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, consent: true }) });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) return setFailed(s.phoneApproveFailed(String(result?.reason ?? "unavailable")));
      } catch {
        return setFailed(s.phoneApproveFailed("unavailable"));
      } finally {
        setBusy(false);
      }
    }
    onSave(phone);
    setDraft(null);
    setChecking(false);
    setSaved(true);
  };
  return (
    <div>
      {checking ? (
        <div role="group" aria-label={s.phoneCheck(name)} className="naqah-saved-in rounded-xl border border-sand bg-ivory p-4">
          <p className="text-[0.9375rem] text-espresso">{s.phoneCheck(name)}</p>
          <p dir="ltr" className="ltr-nums mt-1 text-start text-[1.25rem] font-bold text-espresso">{formatSaudiMobile(draft)}</p>
          {OWNER_APPROVES_NUMBERS ? (
            <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-[0.9375rem] text-espresso">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brown" />
              <span>{s.phoneConsent}</span>
            </label>
          ) : null}
          {failed ? <p role="alert" className="mt-2 text-[0.9375rem] text-danger">{failed}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" autoFocus disabled={busy || (OWNER_APPROVES_NUMBERS && !consent)} onClick={() => void confirm()} className={`${button} bg-brown text-ivory hover:bg-espresso disabled:cursor-not-allowed disabled:bg-stone disabled:text-muted`}>
              {s.phoneConfirm}
            </button>
            <button type="button" onClick={() => setChecking(false)} className={`${button} border border-stone bg-ivory text-espresso hover:border-sand`}>
              {s.phoneEdit}
            </button>
          </div>
        </div>
      ) : (
        <>
          <PhoneField label={label} autoComplete="off" value={draft} showError={draft.trim() !== ""} onChange={setDraft} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={!valid} onClick={() => setChecking(true)} className={`${button} bg-brown text-ivory hover:bg-espresso disabled:cursor-not-allowed disabled:bg-stone disabled:text-muted`}>
              {s.phoneSave}
            </button>
            <button type="button" onClick={cancel} className={`${button} text-muted hover:text-espresso`}>
              {s.phoneCancel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function TeamFields({ ws, onChange, showErrors = false, confirmPhone = false }: SetupFieldsProps & { confirmPhone?: boolean }) {
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
                    {confirmPhone && isSaudiMobile(worker.phone) ? (
                      <ConfirmedPhone label={s.phone} name={worker.name.trim() || label} value={worker.phone} onSave={(phone) => editWorker(index, { phone })} />
                    ) : (
                      <PhoneField
                        label={s.phone}
                        autoComplete="off"
                        value={worker.phone}
                        showError={showErrors}
                        requiredMessage={primary ? m.setup.call.needWorkerPhone : undefined}
                        onChange={(phone) => editWorker(index, { phone })}
                      />
                    )}
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
            className="naqah-press inline-flex min-h-12 items-center gap-2 rounded-full border border-stone bg-cream px-5 font-semibold text-espresso transition hover:border-sand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:text-muted"
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
