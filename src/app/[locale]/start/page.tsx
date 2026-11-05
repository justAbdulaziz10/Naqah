"use client";

import { ArrowLeft, ArrowRight, Check, CheckCircle, Info } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CamelMark } from "@/components/brand/CamelMark";
import { Logo } from "@/components/brand/Logo";
import {
  getCallSetupGaps,
  clearReplacementDraft,
  createOnboardingSample,
  createReplacementDraft,
  hasOwnSetupData,
  phoneNeedsFixing,
  readReplacementDraft,
  replacementLoss,
  saveReplacementDraft,
  subscribeReplacementDraft,
  type CallSetupGap,
  type WorkspaceUpdate,
} from "@/components/setup";
import {
  DetailsStep,
  ExistingFarmChoice,
  OwnerFarmStep,
  PlanStep,
  ReviewStep,
  ScheduleStep,
  WorkerStep,
  type WizardStepKey,
} from "@/components/setup/onboarding/WizardSteps";
import { StepHead } from "@/components/setup/onboarding/WizardParts";
import { ConfirmDialog } from "@/components/ui";
import { isValidWindow } from "@/domain/clock";
import { uid } from "@/domain/id";
import type { Plan, Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { onboarding as onboardingMessages } from "@/i18n/messages/onboarding";
import { cn } from "@/lib/cn";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { useSaveStatus, useWorkspaceStore } from "@/store/workspace";

const STEPS = ["plan", "ownerFarm", "worker", "details", "schedule", "review"] as const satisfies readonly WizardStepKey[];
type StepKey = (typeof STEPS)[number];

/** Which call-setup gaps each step can fill; Skip only shows while one of them is still open. */
const STEP_GAPS: Partial<Record<StepKey, CallSetupGap[]>> = {
  ownerFarm: ["owner", "farm"],
  worker: ["worker"],
  schedule: ["schedule"],
};

/** Whether this step holds something typed that cannot be used yet. Blank is fine: setup is optional. */
function stepNeedsFixing(key: StepKey, ws: Workspace) {
  const { owner, worker, window } = ws.settings;
  if (key === "ownerFarm") return phoneNeedsFixing(owner.phone);
  if (key === "worker") return phoneNeedsFixing(worker.phone);
  if (key === "schedule") return Boolean(window && !isValidWindow(window));
  return false;
}

export default function StartPage() {
  const router = useRouter();
  const { locale, m, href } = useI18n();
  const hydrated = useWorkspaceStore((state) => state.hydrated);
  const workspace = useWorkspaceStore((state) => state.workspace);
  const startOnboarding = useWorkspaceStore((state) => state.startOnboarding);
  const saveFailed = useSaveStatus((state) => state.status === "failed");
  const [step, setStep] = useState(0);
  const [showStepErrors, setShowStepErrors] = useState(false);
  const [confirmingSample, setConfirmingSample] = useState(false);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [startingOver, setStartingOver] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const isReplacing = workspace?.setupComplete === true;
  const sourceCreatedAt = isReplacing ? workspace.createdAt : undefined;
  const getReplacementSnapshot = useCallback(() => readReplacementDraft(sourceCreatedAt), [sourceCreatedAt]);
  const storedReplacementDraft = useSyncExternalStore(subscribeReplacementDraft, getReplacementSnapshot, () => null);
  const [volatileReplacementDraft, setVolatileReplacementDraft] = useState<Workspace | null>(null);
  // Only built client-side when replacing an existing workspace (never during prerender).
  const emptyReplacementDraft = useMemo(() => {
    if (!isReplacing || !workspace) return null;
    return createReplacementDraft(workspace);
  }, [isReplacing, workspace]);
  const replacementDraft = volatileReplacementDraft ?? storedReplacementDraft; // Set only when the latest write failed.
  const replacementBase = replacementDraft ?? emptyReplacementDraft;
  const activeWorkspace = isReplacing
    ? replacementBase && workspace
      ? { ...replacementBase, camels: workspace.camels } // Re-running setup never replaces the real herd.
      : replacementBase
    : workspace;
  const hasActiveWorkspace = Boolean(activeWorkspace);

  useEffect(() => {
    if (hydrated && !workspace) startOnboarding("basic");
  }, [hydrated, startOnboarding, workspace]);

  useEffect(() => {
    if (!hasActiveWorkspace) return;
    document.getElementById("current-step-title")?.focus({ preventScroll: true });
  }, [hasActiveWorkspace, step, startingOver]);

  if (!hydrated || !activeWorkspace || finishing) {
    return <div className="flex min-h-dvh items-center justify-center px-6 text-center text-muted">{m.onboarding.loading}</div>;
  }

  // A finished farm never lands in the wizard by accident: starting over is its own choice.
  if (isReplacing && workspace && !startingOver) {
    return (
      <div className="min-h-dvh bg-ivory">
        <header className="bg-espresso text-cream">
          <div className="mx-auto flex w-full max-w-[44rem] items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Logo locale={locale} href={href("/")} tone="light" />
            <LocaleSwitcher tone="light" className="px-3" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[44rem] px-4 pb-12 pt-10 sm:px-6 sm:pt-16">
          <ExistingFarmChoice
            ws={workspace}
            resuming={Boolean(replacementDraft)}
            onStartOver={() => setStartingOver(true)}
          />
        </main>
      </div>
    );
  }

  const ws = activeWorkspace;
  const steps: StepKey[] = ws.settings.plan === "basic" ? [...STEPS] : STEPS.filter((key) => key !== "schedule");
  const currentKey = steps[Math.min(step, steps.length - 1)];
  const mutateWorkspace = (update: WorkspaceUpdate) => {
    if (isReplacing && workspace) {
      const next = update(ws);
      setVolatileReplacementDraft(saveReplacementDraft(workspace.createdAt, next) ? null : next);
    }
    else useWorkspaceStore.getState().update(update);
  };
  const fillSample = (plan: Plan = ws.settings.plan) => {
    const sample = createOnboardingSample(locale, plan);
    if (isReplacing && workspace) setVolatileReplacementDraft(saveReplacementDraft(workspace.createdAt, sample) ? null : sample);
    else useWorkspaceStore.getState().update(() => sample);
  };
  const askToFillSample = () => {
    if (hasOwnSetupData(ws)) setConfirmingSample(true);
    else fillSample();
  };
  const editStep = (nextStep: number) => {
    setShowStepErrors(false);
    setStep(Math.max(0, Math.min(nextStep, steps.length - 1)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const editStepByKey = (key: StepKey) => editStep(steps.indexOf(key));
  const callSetupGaps = getCallSetupGaps(ws);
  const canSkipStep = (STEP_GAPS[currentKey] ?? []).some((gap) => callSetupGaps.includes(gap));
  const isLast = step === steps.length - 1;

  function skipStep() {
    editStep(step + 1);
  }

  function nextStep() {
    if (stepNeedsFixing(currentKey, ws)) {
      setShowStepErrors(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("main [aria-invalid='true']")?.focus());
      return;
    }
    editStep(step + 1);
  }

  function confirmSetup() {
    const complete = (current: Workspace): Workspace => ({
      ...current,
      setupComplete: true,
      lastUpdateAt: null,
      events: [...current.events, {
        id: uid("evt"),
        at: new Date().toISOString(),
        tone: "success",
        text: { ar: onboardingMessages.ar.setupEvent, en: onboardingMessages.en.setupEvent },
      }],
    });
    setConfirmingReplace(false);
    setFinishing(true);
    if (isReplacing) {
      useWorkspaceStore.getState().update(() => complete(ws));
      clearReplacementDraft();
      setVolatileReplacementDraft(null);
    } else {
      useWorkspaceStore.getState().update(complete);
    }
    router.push(href("/app"));
  }

  const content = (() => {
    switch (currentKey) {
      case "plan": return <PlanStep ws={ws} onChange={mutateWorkspace} />;
      case "ownerFarm": return <OwnerFarmStep ws={ws} onChange={mutateWorkspace} showErrors={showStepErrors} />;
      case "worker": return <WorkerStep ws={ws} onChange={mutateWorkspace} showErrors={showStepErrors} />;
      case "details": return <DetailsStep ws={ws} onChange={mutateWorkspace} />;
      case "schedule": return <ScheduleStep ws={ws} onChange={mutateWorkspace} showErrors={showStepErrors} />;
      case "review": return <ReviewStep ws={ws} onEdit={editStepByKey} />;
    }
  })();
  const head = m.onboarding.wizard.heads[currentKey];
  const loss = isReplacing && workspace ? replacementLoss(workspace) : null;
  const replaceNotice = isReplacing ? (
    <div className={cn("flex flex-col gap-1 rounded-2xl border border-stone bg-cream px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4", isLast ? "mt-8" : "mb-8")}>
      <p className="flex items-start gap-2.5 text-[0.975rem] leading-relaxed text-espresso">
        <Info size={20} className="mt-0.5 shrink-0 text-brown" aria-hidden />
        {m.onboarding.wizard.replaceNotice}
      </p>
      <Link
        href={href("/app")}
        className="inline-flex min-h-11 shrink-0 items-center self-start rounded-full px-3 text-[0.9375rem] font-semibold text-brown underline decoration-sand underline-offset-4 hover:decoration-brown sm:self-auto"
      >
        {m.onboarding.wizard.backToDashboard}
      </Link>
    </div>
  ) : null;


  return (
    <div className="min-h-dvh bg-ivory lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[25rem_minmax(0,1fr)]">
      {/* Brand panel (desktop): where you are in the setup, on the estate's dark ground. */}
      <div className="hidden bg-espresso lg:block">
      <aside className="relative flex h-dvh flex-col overflow-hidden px-10 py-9 text-cream lg:sticky lg:top-0">
        <Logo locale={locale} href={href("/")} tone="light" />
        <nav aria-label={m.onboarding.wizard.stepsNav} className="relative z-10 mt-16">
          <p className="mb-5 text-[0.9375rem] font-semibold text-sand">{m.onboarding.title}</p>
          <ol className="space-y-1">
            {steps.map((key, index) => {
              const done = index < step;
              const current = index === step;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => editStep(index)}
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-start text-[1.0625rem] transition-colors",
                      current ? "bg-cream/10 font-bold text-cream" : done ? "text-cream/85 hover:bg-cream/5" : "text-cream/60 hover:bg-cream/5 hover:text-cream/85",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
                        current ? "border-gold bg-gold text-espresso" : done ? "border-gold/70 text-gold" : "border-cream/30",
                      )}
                    >
                      {done ? <Check size={13} weight="bold" /> : current ? <span className="size-2 rounded-full bg-espresso" /> : null}
                    </span>
                    <span>{m.onboarding.steps[key]}</span>
                    {done ? <span className="sr-only">({m.onboarding.wizard.stepDone})</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <p className="relative z-10 mt-auto max-w-[17rem] text-[0.9375rem] leading-relaxed text-cream/70">{m.onboarding.wizard.browserOnly}</p>
        {/* The approved mark, unchanged, enlarged and cropped by the panel edge. */}
        <CamelMark className="pointer-events-none absolute -bottom-10 -end-24 h-auto w-[30rem] opacity-[0.09]" />
      </aside>
      </div>

      <div className="flex min-h-dvh flex-col">
        <header className="bg-espresso text-cream lg:bg-transparent lg:text-espresso">
          <div className="mx-auto flex w-full max-w-[44rem] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:max-w-none lg:justify-end lg:px-10 lg:py-6">
            <span className="lg:hidden"><Logo locale={locale} href={href("/")} tone="light" /></span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={askToFillSample}
                className="inline-flex h-10 items-center rounded-full px-3 text-sm font-semibold text-cream transition hover:bg-cream/10 lg:px-4 lg:text-espresso lg:hover:bg-espresso/5"
              >
                <span className="hidden sm:inline">{m.onboarding.sampleData}</span>
                <span className="sm:hidden">{m.onboarding.sampleShort}</span>
              </button>
              <LocaleSwitcher className="px-3 max-lg:text-cream max-lg:hover:bg-cream/10" />
            </div>
          </div>
        </header>

        {/* Progress (phone and tablet). The desktop panel carries the full step list. */}
        <div className="mx-auto w-full max-w-[44rem] px-4 pt-5 sm:px-6 lg:hidden">
          <div className="flex items-baseline justify-between gap-4 text-[0.9375rem]">
            <span className="font-bold text-espresso">{m.onboarding.steps[currentKey]}</span>
            <span className="text-muted">{m.onboarding.wizard.stepOf(step + 1, steps.length)}</span>
          </div>
          <div
            className="mt-2.5 flex gap-1.5"
            role="progressbar"
            aria-label={m.onboarding.progressLabel}
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
            aria-valuetext={`${m.onboarding.wizard.stepOf(step + 1, steps.length)} · ${m.onboarding.steps[currentKey]}`}
          >
            {steps.map((key, index) => (
              <span key={key} className={cn("h-1.5 flex-1 rounded-full", index <= step ? "bg-brown" : "bg-stone")} />
            ))}
          </div>
        </div>

        <main className="mx-auto w-full max-w-[44rem] flex-1 px-4 pb-12 pt-8 sm:px-6 sm:pt-10 lg:pt-[max(2rem,7vh)]">
          <StepHead title={head.title} lead={head.lead} />
          {/* Replacing an existing farm: say so where the choice starts and where it is confirmed. */}
          {step === 0 ? replaceNotice : null}
          {content}
          {isLast ? replaceNotice : null}
          {saveFailed || volatileReplacementDraft ? (
            <p className="mt-6 text-[0.975rem] leading-relaxed text-danger" role="alert">{m.onboarding.wizard.notSavedNotice}</p>
          ) : null}

          {/* Actions sit right under the step, never fixed over fields or the keyboard. */}
          <div className="mt-10 grid grid-cols-2 items-center gap-3 border-t border-stone/80 pt-6 sm:flex sm:flex-row-reverse">
            {isLast ? (
              <button
                type="button"
                onClick={isReplacing ? () => setConfirmingReplace(true) : confirmSetup}
                className="col-span-2 inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-espresso px-7 text-[1.0625rem] font-semibold text-cream transition hover:bg-brown active:scale-[0.98]"
              >
                <CheckCircle size={22} weight="fill" aria-hidden />
                {isReplacing ? m.onboarding.wizard.replaceFinish : m.onboarding.confirmAndOpen}
              </button>
            ) : (
              <button
                type="button"
                data-step-next
                onClick={nextStep}
                className="col-span-2 inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-espresso px-8 text-[1.0625rem] font-semibold text-cream transition hover:bg-brown active:scale-[0.98]"
              >
                {m.common.actions.next}
                <ArrowRight size={20} className="rtl:-scale-x-100" aria-hidden />
              </button>
            )}
            {canSkipStep ? (
              <button
                type="button"
                onClick={skipStep}
                className="col-start-2 row-start-2 inline-flex min-h-12 items-center justify-self-end rounded-full px-4 text-[1rem] font-semibold text-brown underline decoration-sand underline-offset-4 transition hover:decoration-brown"
              >
                {m.onboarding.wizard.skip}
              </button>
            ) : null}
            {step > 0 ? (
              <button
                type="button"
                onClick={() => editStep(step - 1)}
                className="col-start-1 row-start-2 inline-flex min-h-12 items-center gap-2 justify-self-start rounded-full px-4 text-[1rem] font-semibold text-espresso transition hover:bg-espresso/5 sm:me-auto"
              >
                <ArrowLeft size={18} className="rtl:-scale-x-100" aria-hidden />
                {m.common.actions.back}
              </button>
            ) : null}
          </div>
        </main>
      </div>
      {confirmingReplace && loss ? (
        <ConfirmDialog
          title={m.onboarding.wizard.replaceConfirmTitle}
          body={loss.reports + loss.calls + loss.tickets ? m.onboarding.wizard.replaceConfirmBody(loss) : m.onboarding.wizard.replaceConfirmEmpty}
          confirmLabel={m.onboarding.wizard.replaceConfirmAction}
          cancelLabel={m.onboarding.wizard.replaceConfirmCancel}
          onConfirm={confirmSetup}
          onCancel={() => setConfirmingReplace(false)}
        />
      ) : null}
      {confirmingSample ? (
        <ConfirmDialog
          title={m.common.demo.sampleConfirmTitle}
          body={m.common.demo.sampleConfirmSetup}
          confirmLabel={m.common.demo.sampleConfirmAction}
          cancelLabel={m.common.demo.sampleConfirmCancel}
          onConfirm={() => {
            setConfirmingSample(false);
            fillSample();
          }}
          onCancel={() => setConfirmingSample(false)}
        />
      ) : null}
    </div>
  );
}
