"use client";

import { ArrowLeft, ArrowRight, CheckCircle } from "@phosphor-icons/react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import type { WorkspaceUpdate } from "@/components/setup";
import {
  CallStep,
  RanchStep,
  ReadyStep,
  stepNeedsFixing,
  TeamStep,
  WIZARD_STEPS,
  type WizardStepKey,
} from "@/components/setup/onboarding/WizardSteps";
import { StepHead } from "@/components/setup/onboarding/WizardParts";
import { FinishMoment, JourneyBar, JourneyPanel } from "@/components/setup/onboarding/Journey";
import { getCallSetupGaps } from "@/components/setup/CallSetupStatus";
import { buttonClass } from "@/components/ui/Button";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { uid } from "@/domain/id";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { setup as setupMessages } from "@/i18n/messages/setup";
import { planSelectionResumePath } from "@/lib/account/plan-selection-paths";
import { safeReturnPath } from "@/lib/supabase/auth-input";
import { useIsAccount, useSaveStatus, useWorkspaceStore } from "@/store/workspace";

/**
 * Owner onboarding: Ranch → Workers and herd → Report call → Ready. Every field saves as it is
 * typed through `update`, so leaving and coming back loses nothing. A finished farm never lands
 * here: the account boundary (or, in the demo, this page) sends it to the dashboard.
 * The step lives in the URL (`?step=2`), so refresh keeps it and the browser's Back goes one step back.
 */
export default function StartPage() {
  return <Suspense fallback={null}><Onboarding /></Suspense>;
}

function stepFromQuery(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= WIZARD_STEPS.length ? n - 1 : 0;
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const { locale, m, href } = useI18n();
  const f = m.setup.flow;
  const hydrated = useWorkspaceStore((state) => state.hydrated);
  const ws = useWorkspaceStore((state) => state.workspace);
  const startOnboarding = useWorkspaceStore((state) => state.startOnboarding);
  const account = useIsAccount();
  const returnTo = safeReturnPath(params.get("returnTo"));
  const saveFailed = useSaveStatus((state) => state.status === "failed") && !account; // The account banner covers it.
  const step = stepFromQuery(params.get("step"));
  const [showErrors, setShowErrors] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Which way the last step change went, so the new step slides in from the matching side.
  const [seen, setSeen] = useState({ step, back: false });
  if (seen.step !== step) setSeen({ step, back: step < seen.step });
  const finished = ws?.setupComplete === true;
  const editing = Boolean(ws) && !finished;

  useEffect(() => {
    if (hydrated && !ws && !account) startOnboarding("basic");
  }, [account, hydrated, startOnboarding, ws]);

  useEffect(() => {
    // A farm finished elsewhere goes straight on; one finished here first shows its moment (see finish()).
    if (finished && !finishing) router.replace(account ? planSelectionResumePath(locale, true, returnTo) : href("/app"));
  }, [account, finished, finishing, href, locale, returnTo, router]);

  // Focus the heading once per step, not on every keystroke.
  useEffect(() => {
    if (editing) document.getElementById("current-step-title")?.focus({ preventScroll: true });
  }, [editing, step]);

  if (finishing) return <FinishMoment />;
  if (!hydrated || !ws || finished) {
    return <div role="status" className="flex min-h-dvh items-center justify-center px-6 text-center text-muted">{finished ? f.opening : f.loading}</div>;
  }

  const steps = WIZARD_STEPS;
  const current: WizardStepKey = steps[Math.min(step, steps.length - 1)];
  const isLast = step === steps.length - 1;
  const change = (update: WorkspaceUpdate) => useWorkspaceStore.getState().update(update);

  function go(next: number) {
    const target = Math.max(0, Math.min(next, steps.length - 1));
    setShowErrors(false);
    if (target === step) return;
    const query = new URLSearchParams();
    if (target > 0) query.set("step", String(target + 1));
    if (returnTo) query.set("returnTo", returnTo);
    router.push(`${href("/start")}${query.size ? `?${query}` : ""}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function nextStep() {
    const invalid = stepNeedsFixing(current, ws!) || Boolean(document.querySelector("main [aria-invalid='true']"));
    if (invalid) {
      setShowErrors(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("main [aria-invalid='true']")?.focus());
      return;
    }
    go(step + 1);
  }

  function finish() {
    // The step list lets an owner jump ahead; the ranch name is still required.
    const missing = steps.findIndex((key) => stepNeedsFixing(key, ws!));
    if (missing >= 0) {
      go(missing);
      requestAnimationFrame(() => setShowErrors(true));
      return;
    }
    setFinishing(true);
    useWorkspaceStore.getState().update((latest: Workspace) => ({
      ...latest,
      setupComplete: true,
      events: [...latest.events, {
        id: uid("evt"),
        at: new Date().toISOString(),
        tone: "success",
        text: { ar: setupMessages.ar.flow.setupEvent, en: setupMessages.en.flow.setupEvent },
      }],
    }));
    // A short, calm completion moment, then the dashboard (at once with reduced motion).
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const destination = account ? planSelectionResumePath(locale, true, returnTo) : href("/app");
    window.setTimeout(() => router.replace(destination), reduced ? 0 : 1400);
  }

  const content = (() => {
    switch (current) {
      case "ranch": return <RanchStep ws={ws} onChange={change} showErrors={showErrors} />;
      case "team": return <TeamStep ws={ws} onChange={change} showErrors={showErrors} />;
      case "call": return <CallStep ws={ws} onChange={change} showErrors={showErrors} />;
      case "ready": return <ReadyStep ws={ws} onEdit={(key) => go(steps.indexOf(key))} />;
    }
  })();
  // "Ready" only when NAQAH has everything it needs to call.
  const heads = m.onboarding.flow.heads;
  // In the demo the ranch step opens with the plan cards, so its line names the plan first.
  const head = current === "ready" && getCallSetupGaps(ws).length ? heads.almost : current === "ranch" && !account ? heads.ranchDemo : heads[current];

  return (
    <div className="min-h-dvh bg-ivory lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[25rem_minmax(0,1fr)]">
      <div className="hidden lg:block">
        <JourneyPanel ws={ws} step={step} onGo={go} />
      </div>

      <div className="flex min-h-dvh flex-col">
        <header className="bg-espresso text-cream lg:bg-transparent lg:text-espresso">
          <div className="mx-auto flex w-full max-w-[44rem] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:max-w-none lg:justify-end lg:px-10 lg:py-6">
            <span className="lg:hidden"><Logo locale={locale} href={href("/")} tone="light" /></span>
            <LocaleSwitcher className="px-3 max-lg:text-cream max-lg:hover:bg-cream/10" />
          </div>
        </header>

        <main className="flex flex-1 flex-col">
          <JourneyBar step={step} />
          <div className="mx-auto w-full max-w-[44rem] flex-1 px-4 pb-12 pt-8 sm:px-6 sm:pt-10 lg:pt-[max(2rem,7vh)]">
          <div key={current} className={seen.back ? "naqah-step-back" : "naqah-step-in"}>
            <StepHead title={head.title} lead={head.lead} />
            {content}
          </div>
          {saveFailed ? <p className="mt-6 text-[0.975rem] leading-relaxed text-danger" role="alert">{f.notSaved}</p> : null}

          {account || isLast ? null : <p className="mt-10 text-[0.9375rem] text-muted lg:hidden">{f.demoNote}</p>}

          {/* Phones: the actions stay in thumb reach at the bottom while the step scrolls; wider screens keep them under the step. */}
          <div className="sticky bottom-0 z-20 -mx-4 mt-8 flex items-center justify-between gap-3 border-t border-stone/80 bg-ivory px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:mt-10 sm:px-0 sm:pb-0 sm:pt-6">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => go(step - 1)}
                className="naqah-press inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-4 text-[1rem] font-semibold text-espresso hover:bg-espresso/5"
              >
                <ArrowLeft size={18} className="rtl:-scale-x-100" aria-hidden />
                {m.common.actions.back}
              </button>
            ) : <span />}
            <button
              type="button"
              data-step-next={isLast ? undefined : ""}
              onClick={isLast ? finish : nextStep}
              className={buttonClass({ size: "lg", className: "naqah-press px-8 shadow-none! max-sm:flex-1" })}
            >
              {isLast ? (
                <>
                  <CheckCircle size={22} weight="fill" aria-hidden />
                  {f.openDashboard}
                </>
              ) : (
                <>
                  {m.common.actions.next}
                  <ArrowRight size={20} className="rtl:-scale-x-100" aria-hidden />
                </>
              )}
            </button>
          </div>
          </div>
        </main>
      </div>
    </div>
  );
}
