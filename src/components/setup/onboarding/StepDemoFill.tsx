"use client";

import { useState } from "react";
import { DEMO_AUTOFILL, DemoFillButton } from "@/components/demo/DemoFill";
import { fillSampleStep } from "@/components/demo/sampleRanch";
import { useI18n } from "@/i18n/client";
import { useIsAccount, useWorkspaceStore } from "@/store/workspace";
import type { WizardStepKey } from "./WizardSteps";

/**
 * LOCAL DEMO ONLY: «تعبئة تجريبية» under a step's heading. It fills the step through the same `update` the
 * fields use (as if the owner had typed it), then hands focus to the step's primary action. It never presses
 * Next or Finish, and the step checks stay as they are. `onFilled` lets the page reset the fields' own state.
 */
export function StepDemoFill({ step, onFilled }: { step: WizardStepKey; onFilled: () => void }) {
  const { locale, m } = useI18n();
  const account = useIsAccount();
  const [filled, setFilled] = useState(false);
  if (!DEMO_AUTOFILL) return null;

  function fill() {
    useWorkspaceStore.getState().update((ws) => fillSampleStep(step, ws, { locale, choosePlan: !account }));
    setFilled(true);
    onFilled();
    requestAnimationFrame(() => document.getElementById("step-primary")?.focus({ preventScroll: true }));
  }

  return (
    <div className="-mt-3 mb-8 sm:-mt-5 sm:mb-10">
      <DemoFillButton onFill={fill} />
      <p role="status" className="sr-only">{filled ? m.onboarding.flow.demoFilled : null}</p>
    </div>
  );
}
