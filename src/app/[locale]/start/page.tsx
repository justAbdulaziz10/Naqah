"use client";

import { ArrowLeft, ArrowRight, CheckCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import {
  HerdSection,
  OwnerFarmSection,
  PlanSection,
  QuestionsSection,
  ResourcesSection,
  ScheduleSection,
  WhatMattersSection,
  WorkerSection,
  clearReplacementDraft,
  createOnboardingSample,
  readReplacementDraft,
  saveReplacementDraft,
  subscribeReplacementDraft,
  type WorkspaceUpdate,
} from "@/components/setup";
import { Button, ButtonLink } from "@/components/ui";
import {
  CRITERION_LABELS,
  EMERGENCY_LABELS,
  RESOURCE_LABELS,
  WEEKDAY_LABELS,
  WORKER_LANGUAGES,
} from "@/domain/catalog";
import { uid } from "@/domain/id";
import { isValidWindow } from "@/domain/clock";
import { applicableQuestions, customQuestionLimit } from "@/domain/rules";
import type { CriterionKind, EmergencyKind, Plan, Workspace } from "@/domain/types";
import { createEmptyWorkspace } from "@/domain/seed";
import { useI18n } from "@/i18n/client";
import { onboarding as onboardingMessages } from "@/i18n/messages/onboarding";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { useWorkspaceStore } from "@/store/workspace";

const STEPS = ["plan", "ownerFarm", "herd", "resources", "worker", "criteria", "questions", "schedule", "review"] as const;
type StepKey = (typeof STEPS)[number];

function isStepValid(step: number, ws: Workspace): boolean {
  switch (step) {
    case 0:
      return true;
    case 1:
      return Boolean(ws.settings.owner.name.trim() && ws.settings.owner.phone.trim() && ws.settings.farm.name.trim() && ws.settings.farm.location.trim());
    case 2:
      return ws.camels.length > 0;
    case 4:
      return Boolean(ws.settings.worker.name.trim() && ws.settings.worker.phone.trim());
    case 6:
      return ws.settings.customQuestions.length <= customQuestionLimit(ws);
    case 7: {
      if (ws.settings.plan === "ultimate") return true;
      const window = ws.settings.window;
      return Boolean(window?.start && window.end && isValidWindow(window));
    }
    default:
      return true;
  }
}

function summaryCriterion(kind: CriterionKind, label: string | null, t: (value: { ar: string; en: string }) => string) {
  return kind === "custom" ? label ?? "" : t(CRITERION_LABELS[kind]);
}

function summaryEmergency(kind: EmergencyKind, label: string | null, t: (value: { ar: string; en: string }) => string) {
  return kind === "custom" ? label ?? "" : t(EMERGENCY_LABELS[kind]);
}

function ReviewCard({
  title,
  step,
  onEdit,
  children,
}: {
  title: string;
  step: number;
  onEdit: (step: number) => void;
  children: ReactNode;
}) {
  const { m } = useI18n();
  return (
    <article className="rounded-2xl border border-stone/80 bg-cream px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-bold text-espresso">{title}</h2>
        <button
          type="button"
          onClick={() => onEdit(step)}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-brown underline decoration-stone underline-offset-4 transition hover:decoration-brown focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/20"
        >
          {m.onboarding.editSection}
        </button>
      </div>
      <div className="mt-2 space-y-1 text-sm leading-relaxed text-muted">{children}</div>
    </article>
  );
}

function Review({ ws, onEdit }: { ws: Workspace; onEdit: (step: number) => void }) {
  const { m, t } = useI18n();
  const applicable = applicableQuestions(ws);
  const workerLanguage = WORKER_LANGUAGES.find((language) => language.id === ws.settings.worker.language) ?? WORKER_LANGUAGES[0];
  const resources = ws.resources.filter((resource) => resource.present).map((resource) => t(RESOURCE_LABELS[resource.kind]));
  const criteria = ws.settings.criteria.filter((criterion) => criterion.enabled).map((criterion) => summaryCriterion(criterion.kind, criterion.label, t));
  const emergencies = ws.settings.emergencies.map((emergency) => summaryEmergency(emergency.kind, emergency.label, t));
  const customQuestionCount = ws.settings.customQuestions.length;

  return (
    <div className="space-y-4">
      <p className="text-muted">{m.onboarding.reviewReady}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <ReviewCard title={m.onboarding.planSummary} step={0} onEdit={onEdit}>
          <p>{m.common.plans[ws.settings.plan]}</p>
        </ReviewCard>
        <ReviewCard title={m.onboarding.ownerFarmSummary} step={1} onEdit={onEdit}>
          <p>{ws.settings.owner.name}</p>
          <p className="ltr-nums">{ws.settings.owner.phone}</p>
          <p>{ws.settings.farm.name} · {ws.settings.farm.location}</p>
        </ReviewCard>
        <ReviewCard title={m.onboarding.herdSummary} step={2} onEdit={onEdit}>
          <p>{m.onboarding.camelSummary(ws.camels.length)}</p>
          <ul className="mt-2 space-y-1">
            {ws.camels.map((camel) => (
              <li key={camel.id} className="flex justify-between gap-3">
                <span>{camel.name}</span><span className="ltr-nums">{camel.tag}</span>
              </li>
            ))}
          </ul>
        </ReviewCard>
        <ReviewCard title={m.onboarding.resourcesSummary} step={3} onEdit={onEdit}>
          <p>{resources.length ? resources.join(" · ") : m.onboarding.noResources}</p>
        </ReviewCard>
        <ReviewCard title={m.onboarding.workerSummary} step={4} onEdit={onEdit}>
          <p>{ws.settings.worker.name} · {workerLanguage.native} ({t(workerLanguage.label)})</p>
          <p className="ltr-nums">{ws.settings.worker.phone}</p>
        </ReviewCard>
        <ReviewCard title={m.onboarding.criteriaSummary} step={5} onEdit={onEdit}>
          {criteria.length ? <ul>{criteria.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{m.onboarding.noActiveCriteria}</p>}
        </ReviewCard>
        <ReviewCard title={m.onboarding.emergencySummary} step={5} onEdit={onEdit}>
          {emergencies.length ? <ul>{emergencies.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{m.onboarding.noEmergencyCategories}</p>}
        </ReviewCard>
        <ReviewCard title={m.onboarding.questionsSummary} step={6} onEdit={onEdit}>
          <p>{m.onboarding.predefinedSummary(applicable.length)}</p>
          <p>{m.onboarding.questionSummary(customQuestionCount)}</p>
          {ws.settings.customQuestions.length ? (
            <ul className="mt-2 space-y-1">
              {ws.settings.customQuestions.map((question) => <li key={question.id}>{question.text}</li>)}
            </ul>
          ) : null}
        </ReviewCard>
        <ReviewCard title={m.onboarding.scheduleSummary} step={7} onEdit={onEdit}>
          {ws.settings.plan === "basic" && ws.settings.window ? (
            <p>{t(WEEKDAY_LABELS[ws.settings.window.day])} · <span className="ltr-nums">{ws.settings.window.start}–{ws.settings.window.end}</span></p>
          ) : (
            <p>{m.onboarding.ultimateSchedule}</p>
          )}
        </ReviewCard>
      </div>
    </div>
  );
}

export default function StartPage() {
  const router = useRouter();
  const { locale, m, href } = useI18n();
  const hydrated = useWorkspaceStore((state) => state.hydrated);
  const workspace = useWorkspaceStore((state) => state.workspace);
  const startOnboarding = useWorkspaceStore((state) => state.startOnboarding);
  const [step, setStep] = useState(0);
  const isReplacing = workspace?.setupComplete === true;
  const sourceCreatedAt = isReplacing ? workspace.createdAt : undefined;
  const getReplacementSnapshot = useCallback(() => readReplacementDraft(sourceCreatedAt), [sourceCreatedAt]);
  const storedReplacementDraft = useSyncExternalStore(subscribeReplacementDraft, getReplacementSnapshot, () => null);
  const [volatileReplacementDraft, setVolatileReplacementDraft] = useState<Workspace | null>(null);
  // Only built client-side when replacing an existing workspace (never during prerender).
  const emptyReplacementDraft = useMemo(() => (isReplacing ? createEmptyWorkspace("basic") : null), [isReplacing]);
  const replacementDraft = storedReplacementDraft ?? volatileReplacementDraft;
  const activeWorkspace = isReplacing ? replacementDraft ?? emptyReplacementDraft : workspace;
  const hasActiveWorkspace = Boolean(activeWorkspace);

  useEffect(() => {
    if (hydrated && !workspace) startOnboarding("basic");
  }, [hydrated, startOnboarding, workspace]);

  useEffect(() => {
    if (!hasActiveWorkspace) return;
    document.getElementById("current-step-title")?.focus({ preventScroll: true });
  }, [hasActiveWorkspace, step]);

  if (!hydrated || !activeWorkspace) {
    return <div className="flex min-h-dvh items-center justify-center px-6 text-center text-muted">{m.onboarding.loading}</div>;
  }

  const ws = activeWorkspace;
  const currentKey: StepKey = STEPS[step];
  const valid = isStepValid(step, ws);
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
  const editStep = (nextStep: number) => {
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  function confirmSetup() {
    if (!valid) return;
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
      case "plan": return <PlanSection ws={ws} onChange={mutateWorkspace} />;
      case "ownerFarm": return <OwnerFarmSection ws={ws} onChange={mutateWorkspace} showErrors />;
      case "herd": return <HerdSection ws={ws} onChange={mutateWorkspace} showErrors />;
      case "resources": return <ResourcesSection ws={ws} onChange={mutateWorkspace} />;
      case "worker": return <WorkerSection ws={ws} onChange={mutateWorkspace} showErrors />;
      case "criteria": return <WhatMattersSection ws={ws} onChange={mutateWorkspace} />;
      case "questions": return <QuestionsSection ws={ws} onChange={mutateWorkspace} />;
      case "schedule": return <ScheduleSection ws={ws} onChange={mutateWorkspace} showErrors />;
      case "review": return <Review ws={ws} onEdit={editStep} />;
    }
  })();

  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <header className="border-b border-stone/70 bg-cream/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <Logo locale={locale} href={href("/")} />
          <div className="order-3 w-full sm:order-2 sm:w-auto sm:flex-1 sm:px-6">
            <div className="flex items-center justify-between gap-4 text-sm font-semibold text-muted">
              <span>{m.onboarding.stepProgress(step + 1, STEPS.length)}</span>
              <span className="truncate">{m.onboarding.steps[currentKey]}</span>
            </div>
            <div
              className="mt-2 h-1 overflow-hidden rounded-full bg-stone/70"
              role="progressbar"
              aria-label={m.onboarding.progressLabel}
              aria-valuemin={1}
              aria-valuemax={STEPS.length}
              aria-valuenow={step + 1}
            >
              <div className="h-full rounded-full bg-gold transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </div>
          </div>
          <div className="order-2 flex items-center gap-1 sm:order-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 px-2.5 sm:px-3"
              onClick={() => fillSample()}
            >
              <span className="hidden sm:inline">{m.onboarding.sampleData}</span>
              <span className="sm:hidden">{m.onboarding.sampleShort}</span>
            </Button>
            <LocaleSwitcher className="px-2.5 sm:px-3.5" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-7 sm:px-6 sm:pt-10 lg:pb-10">
        <h1 id="current-step-title" tabIndex={-1} className="sr-only">{m.onboarding.title}: {m.onboarding.steps[currentKey]}</h1>
        {isReplacing ? (
          <div className="mb-5 flex flex-col justify-between gap-3 rounded-2xl border border-sand/70 bg-gold-soft/40 px-4 py-3 sm:flex-row sm:items-center">
            <p className="text-sm font-medium text-espresso">{m.onboarding.existingFarmNotice}</p>
            <ButtonLink href={href("/app")} variant="ghost" size="sm" className="self-start sm:self-auto">
              {m.common.actions.openDashboard}
            </ButtonLink>
          </div>
        ) : null}
        {content}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-stone/70 bg-cream/95 px-4 pt-3 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent lg:px-0 lg:pb-8 lg:pt-0 lg:backdrop-blur-none">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="md"
            className="min-w-28"
            disabled={step === 0}
            onClick={() => editStep(step - 1)}
          >
            <ArrowLeft size={18} className="rtl:-scale-x-100" aria-hidden />
            {m.common.actions.back}
          </Button>
          {step === STEPS.length - 1 ? (
            <Button size="md" className="px-3 text-sm sm:px-5" disabled={!valid} onClick={confirmSetup}>
              <CheckCircle size={19} weight="bold" aria-hidden />
              {m.onboarding.confirmAndOpen}
            </Button>
          ) : (
            <Button size="lg" disabled={!valid} onClick={() => editStep(step + 1)}>
              {m.common.actions.next}
              <ArrowRight size={18} className="rtl:-scale-x-100" aria-hidden />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
