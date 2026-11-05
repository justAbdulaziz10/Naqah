"use client";

import { Check } from "@phosphor-icons/react";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { PLAN_LIMITS } from "@/domain/catalog";
import { isValidWindow } from "@/domain/clock";
import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import type { SetupSectionProps } from "../types";

export function PlanSection({ ws, onChange, showSaved, onBasicWindowRequired }: SetupSectionProps & {
  onBasicWindowRequired?: () => void;
}) {
  const { m } = useI18n();
  const hasTooManyQuestions = ws.settings.customQuestions.length > PLAN_LIMITS.basic.customQuestions;
  const window = ws.settings.window;
  const basicWindowValid = Boolean(window?.start && window.end && isValidWindow(window));

  function choose(plan: Plan) {
    if (plan === ws.settings.plan) return;
    if (plan === "basic" && hasTooManyQuestions) return;
    onChange((current) => ({
      ...current,
      settings: { ...current.settings, plan, ...(plan === "ultimate" ? { window: null } : {}) },
    }));
    if (plan === "basic" && !basicWindowValid) onBasicWindowRequired?.();
  }

  const plans: { id: Plan; title: string; rules: string[] }[] = [
    {
      id: "basic",
      title: m.common.plans.basic,
      rules: [
        m.onboarding.planRules.basicQuestions,
        m.onboarding.planRules.basicReports,
        m.onboarding.planRules.basicCalls,
        m.onboarding.planRules.basicTickets,
      ],
    },
    {
      id: "ultimate",
      title: m.common.plans.ultimate,
      rules: [
        m.onboarding.planRules.ultimateQuestions,
        m.onboarding.planRules.ultimateReports,
        m.onboarding.planRules.ultimateCalls,
        m.onboarding.planRules.ultimateTickets,
      ],
    },
  ];

  return (
    <Card>
      <CardHeader
        title={m.onboarding.sectionTitles.plan}
        action={showSaved ? <span className="text-xs font-medium text-muted">{m.common.actions.saved}</span> : undefined}
      />
      <CardBody>
        <div role="radiogroup" aria-label={m.onboarding.sectionTitles.plan} className="grid gap-3 sm:grid-cols-2">
          {plans.map((plan) => {
            const selected = ws.settings.plan === plan.id;
            const disabled = plan.id === "basic" && hasTooManyQuestions && !selected;
            return (
              <button
                key={plan.id}
                data-plan={plan.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={disabled}
                tabIndex={selected ? 0 : -1}
                disabled={disabled}
                onClick={() => choose(plan.id)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                  event.preventDefault();
                  const next = plan.id === "basic" ? "ultimate" : "basic";
                  const nextButton = document.querySelector<HTMLButtonElement>(`[data-plan="${next}"]`);
                  if (!nextButton || nextButton.disabled) return;
                  nextButton.focus();
                  choose(next);
                }}
                className={`relative flex min-h-44 flex-col items-start rounded-2xl border p-4 text-start transition focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected ? "border-brown bg-ivory" : "border-stone bg-white/55 hover:border-sand"
                }`}
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="text-lg font-bold text-espresso">{plan.title}</span>
                  <span
                    className={`inline-flex size-6 items-center justify-center rounded-full border ${
                      selected ? "border-brown bg-brown text-cream" : "border-stone text-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    <Check size={14} weight="fill" />
                  </span>
                </span>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
                  {plan.rules.map((rule) => <li key={rule}>{rule}</li>)}
                </ul>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-sm text-muted">{m.onboarding.investorNote}</p>
        {hasTooManyQuestions ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {m.onboarding.tooManyQuestionsForBasic}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
