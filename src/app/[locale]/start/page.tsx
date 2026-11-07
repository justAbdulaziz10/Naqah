"use client";

import { ArrowLeft, ArrowRight, Check, CheckCircle } from "@phosphor-icons/react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CamelMark } from "@/components/brand/CamelMark";
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
import { getCallSetupGaps } from "@/components/setup/CallSetupStatus";
import { buttonClass } from "@/components/ui/Button";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { uid } from "@/domain/id";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { setup as setupMessages } from "@/i18n/messages/setup";
import { cn } from "@/lib/cn";
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
  const saveFailed = useSaveStatus((state) => state.status === "failed") && !account; // The account banner covers it.
  const step = stepFromQuery(params.get("step"));
  const [showErrors, setShowErrors] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finished = ws?.setupComplete === true;
  const editing = Boolean(ws) && !finished;

  useEffect(() => {
    if (hydrated && !ws && !account) startOnboarding("basic");
  }, [account, hydrated, startOnboarding, ws]);

  useEffect(() => {
    if (finished) router.replace(href("/app"));
  }, [finished, href, router]);

  // Focus the heading once per step, not on every keystroke.
  useEffect(() => {
    if (editing) document.getElementById("current-step-title")?.focus({ preventScroll: true });
  }, [editing, step]);

  if (!hydrated || !ws || finished || finishing) {
    return <div role="status" className="flex min-h-dvh items-center justify-center px-6 text-center text-muted">{finishing || finished ? f.opening : f.loading}</div>;
  }

  const steps = WIZARD_STEPS;
  const current: WizardStepKey = steps[Math.min(step, steps.length - 1)];
  const isLast = step === steps.length - 1;
  const change = (update: WorkspaceUpdate) => useWorkspaceStore.getState().update(update);

  function go(next: number) {
    const target = Math.max(0, Math.min(next, steps.length - 1));
    setShowErrors(false);
    if (target === step) return;
    router.push(target === 0 ? href("/start") : `${href("/start")}?step=${target + 1}`, { scroll: false });
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
    router.replace(href("/app"));
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
  const head = current === "ready" && getCallSetupGaps(ws).length ? f.heads.almost : f.heads[current];

  return (
    <div className="min-h-dvh bg-ivory lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[25rem_minmax(0,1fr)]">
      {/* Where you are in the setup (desktop), on the estate's dark ground. */}
      <div className="hidden bg-espresso lg:block">
        <aside className="relative flex h-dvh flex-col overflow-hidden px-10 py-9 text-cream lg:sticky lg:top-0">
          <Logo locale={locale} href={href("/")} tone="light" />
          <nav aria-label={f.stepsNav} className="relative z-10 mt-16">
            <p className="mb-5 text-[0.9375rem] font-semibold text-sand">{f.title}</p>
            <ol className="space-y-1">
              {steps.map((key, index) => {
                const done = index < step && !stepNeedsFixing(key, ws);
                const here = index === step;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => go(index)}
                      aria-current={here ? "step" : undefined}
                      className={cn(
                        "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-start text-[1.0625rem] transition-colors",
                        here ? "bg-cream/10 font-bold text-cream" : done ? "text-cream/85 hover:bg-cream/5" : "text-cream/60 hover:bg-cream/5 hover:text-cream/85",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
                          here ? "border-gold bg-gold text-espresso" : done ? "border-gold/70 text-gold" : "border-cream/30",
                        )}
                      >
                        {done ? <Check size={13} weight="bold" /> : here ? <span className="size-2 rounded-full bg-espresso" /> : null}
                      </span>
                      <span>{f.steps[key]}</span>
                      {done ? <span className="sr-only">({f.stepDone})</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          {account ? null : <p className="relative z-10 mt-auto max-w-[17rem] text-[0.9375rem] leading-relaxed text-cream/70">{f.demoNote}</p>}
          {/* The approved mark, unchanged, enlarged and cropped by the panel edge. */}
          <CamelMark className="pointer-events-none absolute -bottom-10 -end-24 h-auto w-[30rem] opacity-[0.09]" />
        </aside>
      </div>

      <div className="flex min-h-dvh flex-col">
        <header className="bg-espresso text-cream lg:bg-transparent lg:text-espresso">
          <div className="mx-auto flex w-full max-w-[44rem] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:max-w-none lg:justify-end lg:px-10 lg:py-6">
            <span className="lg:hidden"><Logo locale={locale} href={href("/")} tone="light" /></span>
            <LocaleSwitcher className="px-3 max-lg:text-cream max-lg:hover:bg-cream/10" />
          </div>
        </header>

        {/* Progress (phone and tablet). The desktop panel carries the full step list. */}
        <div className="mx-auto w-full max-w-[44rem] px-4 pt-5 sm:px-6 lg:hidden">
          <div className="flex items-baseline justify-between gap-4 text-[0.9375rem]">
            <span className="font-bold text-espresso">{f.steps[current]}</span>
            <span className="text-muted">{f.stepOf(step + 1, steps.length)}</span>
          </div>
          <div
            className="mt-2.5 flex gap-1.5"
            role="progressbar"
            aria-label={f.progressLabel}
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
            aria-valuetext={`${f.stepOf(step + 1, steps.length)} · ${f.steps[current]}`}
          >
            {steps.map((key, index) => (
              <span key={key} className={cn("h-1.5 flex-1 rounded-full", index <= step ? "bg-brown" : "bg-stone")} />
            ))}
          </div>
        </div>

        <main className="mx-auto w-full max-w-[44rem] flex-1 px-4 pb-12 pt-8 sm:px-6 sm:pt-10 lg:pt-[max(2rem,7vh)]">
          <StepHead title={head.title} lead={head.lead} />
          {content}
          {saveFailed ? <p className="mt-6 text-[0.975rem] leading-relaxed text-danger" role="alert">{f.notSaved}</p> : null}

          {/* Actions sit right under the step, never fixed over fields or the keyboard. */}
          <div className="mt-10 flex flex-col-reverse gap-3 border-t border-stone/80 pt-6 sm:flex-row sm:items-center sm:justify-between">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => go(step - 1)}
                className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-full px-4 text-[1rem] font-semibold text-espresso transition hover:bg-espresso/5 sm:self-auto"
              >
                <ArrowLeft size={18} className="rtl:-scale-x-100" aria-hidden />
                {m.common.actions.back}
              </button>
            ) : <span className="hidden sm:block" />}
            <button
              type="button"
              data-step-next={isLast ? undefined : ""}
              onClick={isLast ? finish : nextStep}
              className={buttonClass({ size: "lg", className: "px-8" })}
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
        </main>
      </div>
    </div>
  );
}
