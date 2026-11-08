"use client";

import {
  AddressBook,
  Barricade,
  CalendarCheck,
  ChatCircleText,
  ClipboardText,
  Drop,
  FirstAidKit,
  Grains,
  Heartbeat,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  PhoneCall,
  Pill,
  Plus,
  Tent,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  CRITERION_LABELS,
  PLAN_LIMITS,
  RESOURCE_KINDS,
  RESOURCE_LABELS,
  WEEKDAY_LABELS,
  WORKER_LANGUAGES,
} from "@/domain/catalog";
import { isValidWindow } from "@/domain/clock";
import { uid } from "@/domain/id";
import type { CriterionKind, Plan, ReportingWindow, ResourceKind, Weekday, Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { useIsAccount } from "@/store/workspace";
import { cn } from "@/lib/cn";
import { isLiveCallLanguage } from "@/lib/voice/liveCallLanguages";
import { getCallSetupGaps, hasCompleteWindow } from "../CallSetupStatus";
import { formatSaudiMobile, phoneNeedsFixing } from "../phone";
import type { WorkspaceUpdate } from "../types";
import { ChoiceRow, FieldGroup, PhoneField, StepField, StepHead, StepInput, StepSelect } from "./WizardParts";

export type WizardStepKey = "plan" | "ownerFarm" | "worker" | "details" | "schedule" | "review";

interface StepProps {
  ws: Workspace;
  onChange: (update: WorkspaceUpdate) => void;
}

const ICON = 24;

/* ─── Existing farm ────────────────────────────────────────────────────── */

/** Shown instead of the wizard when setup is opened for a farm that is already set up. */
export function ExistingFarmChoice({ ws, resuming, onStartOver }: { ws: Workspace; resuming: boolean; onStartOver: () => void }) {
  const { m, href } = useI18n();
  const existing = m.onboarding.wizard.existing;

  return (
    <div>
      <StepHead title={existing.title} lead={existing.lead(ws.settings.farm.name.trim())} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={href("/app")}
          className="inline-flex min-h-14 items-center justify-center rounded-full bg-espresso px-8 text-[1.0625rem] font-semibold text-cream transition hover:bg-brown active:scale-[0.98]"
        >
          {existing.open}
        </Link>
        <Link
          href={href("/app/settings")}
          className="inline-flex min-h-14 items-center justify-center rounded-full border border-stone bg-white px-7 text-[1.0625rem] font-semibold text-espresso transition hover:border-sand"
        >
          {existing.settings}
        </Link>
      </div>
      <div className="mt-10 border-t border-stone/80 pt-6">
        <button
          type="button"
          onClick={onStartOver}
          className="inline-flex min-h-12 items-center text-[1rem] font-semibold text-brown underline decoration-sand underline-offset-4 transition hover:decoration-brown"
        >
          {resuming ? existing.continueOver : existing.startOver}
        </button>
        <p className="mt-1 max-w-[52ch] text-[0.9375rem] leading-relaxed text-muted">{existing.startOverNote}</p>
      </div>
    </div>
  );
}

/* ─── Plan ─────────────────────────────────────────────────────────────── */

export function PlanStep({ ws, onChange }: StepProps) {
  const { m } = useI18n();
  const hasTooManyQuestions = ws.settings.customQuestions.length > PLAN_LIMITS.basic.customQuestions;

  function choose(plan: Plan) {
    if (plan === ws.settings.plan) return;
    if (plan === "basic" && hasTooManyQuestions) return;
    onChange((current) => ({
      ...current,
      settings: { ...current.settings, plan, ...(plan === "ultimate" ? { window: null } : {}) },
    }));
  }

  // Same four benefits in the same order for both plans; on wide screens each line sits level with its pair.
  const benefits = m.onboarding.wizard.planBenefits;
  const plans: { id: Plan; benefits: { icon: ReactNode; text: string; off?: boolean }[] }[] = (["basic", "ultimate"] as const).map((id) => ({
    id,
    benefits: [
      { icon: <CalendarCheck size={22} />, text: benefits[id].reports },
      { icon: <PhoneCall size={22} />, text: benefits[id].calls },
      { icon: <ChatCircleText size={22} />, text: benefits[id].questions },
      { icon: <ClipboardText size={22} />, text: benefits[id].tasks, off: id === "basic" },
    ],
  }));

  return (
    <div>
      <div role="radiogroup" aria-labelledby="current-step-title" className="grid gap-4 md:grid-cols-2 md:grid-rows-[auto_repeat(4,auto)] md:gap-y-0">
        {plans.map((plan) => {
          const selected = ws.settings.plan === plan.id;
          const disabled = plan.id === "basic" && hasTooManyQuestions && !selected;
          return (
            <label
              key={plan.id}
              className={cn(
                "relative flex cursor-pointer flex-col rounded-2xl border-2 p-5 transition-colors md:row-span-5 md:grid md:grid-rows-subgrid md:gap-y-0 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brown sm:p-6",
                selected ? "border-brown bg-white" : "border-stone bg-cream/60 hover:border-sand",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name="plan"
                value={plan.id}
                className="sr-only"
                checked={selected}
                disabled={disabled}
                onChange={() => choose(plan.id)}
              />
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-[1.375rem] font-bold text-espresso">{m.common.plans[plan.id]}</span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full border-2",
                    selected ? "border-brown" : "border-sand bg-white",
                  )}
                >
                  {selected ? <span className="size-3.5 rounded-full bg-brown" /> : null}
                </span>
              </span>
              <ul className="mt-5 space-y-3.5 md:contents">
                {plan.benefits.map((benefit, index) => (
                  <li
                    key={benefit.text}
                    className={cn(
                      "flex items-start gap-3 text-[1.0625rem] leading-snug md:pt-3.5",
                      index === 0 && "md:pt-5",
                      benefit.off ? "text-muted" : "text-espresso",
                    )}
                  >
                    <span aria-hidden className={cn("mt-px shrink-0", benefit.off ? "text-faint" : "text-brown")}>
                      {benefit.off ? <Minus size={22} /> : benefit.icon}
                    </span>
                    <span>{benefit.text}</span>
                  </li>
                ))}
              </ul>
            </label>
          );
        })}
      </div>
      {hasTooManyQuestions ? (
        <p className="mt-4 text-[0.975rem] text-danger" role="alert">
          {m.onboarding.tooManyQuestionsForBasic}
        </p>
      ) : null}
      <p className="mt-5 text-[0.9375rem] text-muted">{m.onboarding.investorNote}</p>
    </div>
  );
}

/* ─── Owner and farm ───────────────────────────────────────────────────── */

export function OwnerFarmStep({ ws, onChange, showErrors = false }: StepProps & { showErrors?: boolean }) {
  const { m } = useI18n();
  const { owner, farm } = ws.settings;
  const w = m.onboarding.wizard;
  const setOwner = (patch: Partial<typeof owner>) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, owner: { ...current.settings.owner, ...patch } } }));

  return (
    <div className="space-y-10">
      <FieldGroup title={w.youGroup}>
        <div className="grid gap-5 sm:grid-cols-2">
          <StepField label={w.yourName}>
            {({ id }) => <StepInput id={id} autoComplete="name" value={owner.name} onChange={(event) => setOwner({ name: event.target.value })} />}
          </StepField>
          <PhoneField label={w.yourPhone} value={owner.phone} showError={showErrors} onChange={(phone) => setOwner({ phone })} />
        </div>
      </FieldGroup>
      <FieldGroup title={w.farmGroup}>
        <StepField label={m.onboarding.farmName} className="sm:max-w-[calc(50%-0.625rem)]">
          {({ id }) => (
            <StepInput
              id={id}
              value={farm.name}
              onChange={(event) => onChange((current) => ({
                ...current,
                settings: { ...current.settings, farm: { ...current.settings.farm, name: event.target.value } },
              }))}
            />
          )}
        </StepField>
      </FieldGroup>
    </div>
  );
}

/* ─── Worker ───────────────────────────────────────────────────────────── */

interface PickedContact {
  name?: string[];
  tel?: string[];
}
type NavigatorWithContacts = Navigator & {
  contacts?: { select: (properties: ("name" | "tel")[], options?: { multiple?: boolean }) => Promise<PickedContact[]> };
};

export function WorkerStep({ ws, onChange, showErrors = false }: StepProps & { showErrors?: boolean }) {
  const { m, t } = useI18n();
  const worker = ws.settings.worker;
  const [contactPickerAvailable, setContactPickerAvailable] = useState(false);
  const selectedLanguage = WORKER_LANGUAGES.find((language) => language.id === worker.language) ?? WORKER_LANGUAGES[0];
  const liveLanguages = WORKER_LANGUAGES.filter((language) => isLiveCallLanguage(language.id));
  const laterLanguages = WORKER_LANGUAGES.filter((language) => !isLiveCallLanguage(language.id));
  const setWorker = (patch: Partial<typeof worker>) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, worker: { ...current.settings.worker, ...patch } } }));
  const languageOption = (language: (typeof WORKER_LANGUAGES)[number]) => (
    <option key={language.id} value={language.id}>
      {language.native === t(language.label) ? language.native : `${language.native} · ${t(language.label)}`}
    </option>
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      const contacts = typeof navigator === "undefined" ? undefined : (navigator as NavigatorWithContacts).contacts;
      if (active) setContactPickerAvailable(typeof contacts?.select === "function");
    });
    return () => { active = false; };
  }, []);

  async function chooseContact() {
    const contacts = (navigator as NavigatorWithContacts).contacts;
    if (typeof contacts?.select !== "function") return;
    try {
      const [contact] = await contacts.select(["name", "tel"], { multiple: false });
      const name = contact?.name?.[0]?.trim();
      const phone = contact?.tel?.[0]?.trim();
      if (name || phone) setWorker({ ...(name ? { name } : {}), ...(phone ? { phone: formatSaudiMobile(phone) } : {}) });
    } catch {
      // The picker can be dismissed without choosing.
    }
  }

  return (
    <div className="space-y-6">
      {contactPickerAvailable ? (
        <button
          type="button"
          onClick={chooseContact}
          className="inline-flex min-h-12 items-center gap-2 rounded-full border border-stone bg-white px-5 font-semibold text-espresso transition hover:border-sand"
        >
          <AddressBook size={20} aria-hidden />
          {m.integrations.weather.chooseFromContacts}
        </button>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <StepField label={m.onboarding.workerName}>
          {({ id }) => <StepInput id={id} autoComplete="off" value={worker.name} onChange={(event) => setWorker({ name: event.target.value })} />}
        </StepField>
        <PhoneField label={m.onboarding.workerPhone} autoComplete="off" value={worker.phone} showError={showErrors} onChange={(phone) => setWorker({ phone })} />
      </div>
      <StepField
        label={m.onboarding.workerLanguage}
        className="sm:max-w-[calc(50%-0.625rem)]"
        hint={isLiveCallLanguage(worker.language) ? m.onboarding.workerLanguageLive : m.onboarding.workerLanguageNotLive(t(selectedLanguage.label))}
      >
        {({ id, describedBy }) => (
          <StepSelect
            id={id}
            aria-describedby={describedBy}
            value={worker.language}
            onChange={(event) => setWorker({ language: event.target.value as typeof worker.language })}
          >
            <optgroup label={m.onboarding.liveCallLanguages}>{liveLanguages.map(languageOption)}</optgroup>
            <optgroup label={m.onboarding.laterCallLanguages}>{laterLanguages.map(languageOption)}</optgroup>
          </StepSelect>
        )}
      </StepField>
    </div>
  );
}

/* ─── Call preferences ─────────────────────────────────────────────────── */

const RESOURCE_ICONS: Record<ResourceKind, ReactNode> = {
  feed: <Grains size={ICON} />,
  water: <Drop size={ICON} />,
  fences: <Barricade size={ICON} />,
  shelter: <Tent size={ICON} />,
  medicine: <FirstAidKit size={ICON} />,
};

type StandardCriterion = Exclude<CriterionKind, "custom">;
const CRITERION_ICONS: Record<StandardCriterion, ReactNode> = {
  sick_camel: <Heartbeat size={ICON} />,
  missing_camel: <MagnifyingGlass size={ICON} />,
  low_feed: <Grains size={ICON} />,
  low_water: <Drop size={ICON} />,
  fence_damage: <Barricade size={ICON} />,
  medicine_low: <Pill size={ICON} />,
};

export function DetailsStep({ ws, onChange }: StepProps) {
  const { m, t } = useI18n();
  const w = m.onboarding.wizard;
  const [customLabel, setCustomLabel] = useState("");
  const criteria = Object.keys(CRITERION_LABELS) as StandardCriterion[];

  function setCriterion(kind: CriterionKind, enabled: boolean) {
    onChange((current) => {
      const found = current.settings.criteria.some((item) => item.kind === kind);
      return {
        ...current,
        settings: {
          ...current.settings,
          criteria: found
            ? current.settings.criteria.map((item) => item.kind === kind ? { ...item, enabled } : item)
            : [...current.settings.criteria, { id: uid("crt"), kind, label: null, enabled }],
        },
      };
    });
  }

  function addCustom() {
    const label = customLabel.trim();
    if (!label) return;
    onChange((current) => ({
      ...current,
      settings: { ...current.settings, criteria: [...current.settings.criteria, { id: uid("crt"), kind: "custom", label, enabled: true }] },
    }));
    setCustomLabel("");
  }

  return (
    <div className="space-y-10">
      <FieldGroup title={w.onFarm}>
        <div className="grid gap-3 sm:grid-cols-2">
          {RESOURCE_KINDS.map((kind) => {
            const resource = ws.resources.find((item) => item.kind === kind);
            if (!resource) return null;
            return (
              <ChoiceRow
                key={kind}
                checked={resource.present}
                icon={RESOURCE_ICONS[kind]}
                label={t(RESOURCE_LABELS[kind])}
                onChange={(present) => onChange((current) => ({
                  ...current,
                  resources: current.resources.map((item) => item.kind === kind ? { ...item, present } : item),
                }))}
              />
            );
          })}
        </div>
        <p className="mt-3 text-[0.9375rem] text-muted">{w.onFarmHint}</p>
      </FieldGroup>

      <FieldGroup title={w.tellMeWhen}>
        <div className="grid gap-3 sm:grid-cols-2">
          {criteria.map((kind) => (
            <ChoiceRow
              key={kind}
              checked={ws.settings.criteria.find((item) => item.kind === kind)?.enabled ?? false}
              icon={CRITERION_ICONS[kind]}
              label={t(CRITERION_LABELS[kind])}
              onChange={(enabled) => setCriterion(kind, enabled)}
            />
          ))}
          {ws.settings.criteria.filter((item) => item.kind === "custom").map((criterion) => {
            const label = criterion.label ?? "";
            return (
              <ChoiceRow
                key={criterion.id}
                checked={criterion.enabled}
                icon={<ChatCircleText size={ICON} />}
                label={label}
                onChange={(enabled) => onChange((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    criteria: current.settings.criteria.map((item) => item.id === criterion.id ? { ...item, enabled } : item),
                  },
                }))}
                trailing={
                  <button
                    type="button"
                    aria-label={m.onboarding.removeCustomCriterion(label)}
                    title={m.onboarding.removeCustomCriterion(label)}
                    className="me-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-danger-soft hover:text-danger"
                    onClick={() => onChange((current) => ({
                      ...current,
                      settings: { ...current.settings, criteria: current.settings.criteria.filter((item) => item.id !== criterion.id) },
                    }))}
                  >
                    <Trash size={20} aria-hidden />
                  </button>
                }
              />
            );
          })}
        </div>
        <form
          className="mt-5 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addCustom();
          }}
        >
          <StepField label={w.somethingElse} className="min-w-0 flex-1">
            {({ id }) => (
              <StepInput id={id} value={customLabel} placeholder={w.somethingElsePlaceholder} onChange={(event) => setCustomLabel(event.target.value)} />
            )}
          </StepField>
          <button
            type="submit"
            disabled={!customLabel.trim()}
            className="inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-full border border-stone bg-white px-5 font-semibold text-espresso transition hover:border-sand disabled:cursor-not-allowed disabled:text-muted"
          >
            <Plus size={18} weight="bold" aria-hidden />
            {m.common.actions.add}
          </button>
        </form>
      </FieldGroup>
    </div>
  );
}

/* ─── Weekly schedule (Basic only) ─────────────────────────────────────── */

export function ScheduleStep({ ws, onChange, showErrors = false }: StepProps & { showErrors?: boolean }) {
  const { m, t } = useI18n();
  const w = m.onboarding.wizard;
  const window = ws.settings.window;
  const bothTimes = Boolean(window?.start && window.end);
  const invalidTimes = Boolean(window && bothTimes && !isValidWindow(window));
  const missingTimes = Boolean(showErrors && window && !bothTimes);

  function updateWindow(patch: Partial<ReportingWindow>) {
    onChange((current) => {
      const previous = current.settings.window;
      const next: ReportingWindow = { day: previous?.day ?? 0, start: previous?.start ?? "", end: previous?.end ?? "", ...patch };
      return { ...current, settings: { ...current.settings, window: next } };
    });
  }

  return (
    <div className="space-y-8">
      <FieldGroup title={w.day}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {WEEKDAY_LABELS.map((day, index) => (
            <ChoiceRow
              key={index}
              type="radio"
              name="report-day"
              checked={window?.day === index}
              label={t(day)}
              onChange={() => updateWindow({ day: index as Weekday })}
            />
          ))}
        </div>
      </FieldGroup>
      <FieldGroup title={w.time}>
      <div className="grid max-w-md grid-cols-2 gap-4">
        <StepField label={w.from}>
          {({ id }) => (
            <StepInput
              id={id}
              type="time"
              className={cn("ltr-nums", missingTimes && !window?.start && "border-danger")}
              disabled={!window}
              aria-invalid={(missingTimes && !window?.start) || undefined}
              value={window?.start ?? ""}
              onChange={(event) => updateWindow({ start: event.target.value })}
            />
          )}
        </StepField>
        <StepField label={w.to}>
          {({ id }) => (
            <StepInput
              id={id}
              type="time"
              className={cn("ltr-nums", (invalidTimes || (missingTimes && !window?.end)) && "border-danger")}
              disabled={!window}
              aria-invalid={invalidTimes || (missingTimes && !window?.end) || undefined}
              value={window?.end ?? ""}
              onChange={(event) => updateWindow({ end: event.target.value })}
            />
          )}
        </StepField>
      </div>
      {invalidTimes ? (
        <p className="mt-3 text-[0.975rem] text-danger" role="alert">{m.onboarding.windowEndAfterStart}</p>
      ) : missingTimes ? (
        <p className="mt-3 text-[0.975rem] text-danger" role="alert">{w.windowIncomplete}</p>
      ) : !window ? (
        <p className="mt-3 text-[0.9375rem] text-muted">{w.pickDayFirst}</p>
      ) : null}
      </FieldGroup>
    </div>
  );
}

/* ─── Review ───────────────────────────────────────────────────────────── */

function ReviewRow({
  label,
  step,
  onEdit,
  children,
}: {
  label: string;
  step: WizardStepKey;
  onEdit: (step: WizardStepKey) => void;
  children: ReactNode;
}) {
  const { m } = useI18n();
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 py-4 sm:grid-cols-[11rem_1fr_auto]">
      <dt className="text-[0.9375rem] font-medium text-muted sm:pt-0.5">{label}</dt>
      <dd className="col-span-2 row-start-2 text-[1.0625rem] leading-relaxed text-espresso sm:col-span-1 sm:col-start-2 sm:row-start-1">
        {children}
      </dd>
      <dd className="col-start-2 row-start-1 sm:col-start-3">
        <button
          type="button"
          onClick={() => onEdit(step)}
          aria-label={m.onboarding.wizard.review.edit(label)}
          className="-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.9375rem] font-semibold text-brown transition hover:bg-espresso/5"
        >
          <PencilSimple size={16} aria-hidden />
          {m.common.actions.edit}
        </button>
      </dd>
    </div>
  );
}

function Missing() {
  const { m } = useI18n();
  return <span className="text-muted">{m.onboarding.wizard.review.notAdded}</span>;
}

export function ReviewStep({ ws, onEdit }: { ws: Workspace; onEdit: (step: WizardStepKey) => void }) {
  const { m, t, locale } = useI18n();
  const account = useIsAccount();
  const list = (items: string[]) => items.join(locale === "ar" ? "، " : ", ");
  const r = m.onboarding.wizard.review;
  const { owner, farm, worker, plan, window } = ws.settings;
  const language = WORKER_LANGUAGES.find((item) => item.id === worker.language) ?? WORKER_LANGUAGES[0];
  const resources = ws.resources.filter((item) => item.present).map((item) => t(RESOURCE_LABELS[item.kind]));
  const criteria = ws.settings.criteria
    .filter((item) => item.enabled)
    .map((item) => item.kind === "custom" ? item.label ?? "" : t(CRITERION_LABELS[item.kind]));
  const gaps = getCallSetupGaps(ws);
  const person = (name: string, phone: string) =>
    name || phone ? (
      <>
        {name || <Missing />}
        {phone ? <> · <bdi className="ltr-nums">{phone}</bdi></> : null}
        {phoneNeedsFixing(phone) ? <span className="block text-[0.9375rem] text-danger">{r.checkNumber}</span> : null}
      </>
    ) : <Missing />;

  return (
    <div className="space-y-8">
      <dl className="divide-y divide-stone/80 border-y border-stone/80">
        <ReviewRow label={r.plan} step="plan" onEdit={onEdit}>{m.common.plans[plan]}</ReviewRow>
        <ReviewRow label={r.you} step="ownerFarm" onEdit={onEdit}>{person(owner.name, owner.phone)}</ReviewRow>
        <ReviewRow label={r.farm} step="ownerFarm" onEdit={onEdit}>{farm.name || <Missing />}</ReviewRow>
        <ReviewRow label={r.worker} step="worker" onEdit={onEdit}>
          {person(worker.name, worker.phone)}
          {worker.name || worker.phone ? (
            <span className="block text-[0.9375rem] text-muted">
              {language.native}
              {isLiveCallLanguage(language.id) ? null : ` · ${m.onboarding.notOnLiveCalls}`}
            </span>
          ) : null}
        </ReviewRow>
        <ReviewRow label={r.asks} step="details" onEdit={onEdit}>
          {resources.length ? list(resources) : <span className="text-muted">{r.nothingChosen}</span>}
        </ReviewRow>
        <ReviewRow label={r.tells} step="details" onEdit={onEdit}>
          {criteria.length ? list(criteria) : <span className="text-muted">{r.nothingChosen}</span>}
        </ReviewRow>
        {plan === "basic" ? (
          <ReviewRow label={r.schedule} step="schedule" onEdit={onEdit}>
            {hasCompleteWindow(window) ? (
              <>{t(WEEKDAY_LABELS[window.day])} · <bdi className="ltr-nums">{window.start}–{window.end}</bdi></>
            ) : window ? <span className="text-danger">{r.scheduleUnfinished}</span> : <Missing />}
          </ReviewRow>
        ) : null}
      </dl>

      <section aria-labelledby="call-readiness" className="rounded-2xl border border-stone bg-cream px-5 py-5 sm:px-6">
        <h2 id="call-readiness" className="flex items-center gap-2 text-lg font-bold text-espresso">
          {gaps.length ? <WarningCircle size={22} className="text-warn" aria-hidden /> : null}
          {m.onboarding.wizard.readyTitle}
        </h2>
        {gaps.length ? (
          <>
            <p className="mt-2 text-[1.0625rem] text-espresso">{m.onboarding.wizard.readyMissing}</p>
            <ul className="mt-1 list-disc space-y-1 ps-6 text-[1.0625rem] text-espresso">
              {gaps.map((gap) => <li key={gap}>{m.onboarding.callSetupItems[gap]}</li>)}
            </ul>
            {account ? null : <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">{m.onboarding.liveCallsUnavailable}</p>}
          </>
        ) : (
          <p className="mt-2 text-[1.0625rem] leading-relaxed text-espresso">{account ? m.account.callsReady : m.onboarding.wizard.readyDone}</p>
        )}
      </section>
    </div>
  );
}
