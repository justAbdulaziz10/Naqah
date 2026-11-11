"use client";

import { Check } from "@phosphor-icons/react";
import { PLAN_LIMITS } from "@/domain/catalog";
import { MONTHLY_PLAN_PRICES_SAR, VAT_PERCENT } from "@/domain/pricing";
import type { Plan, Weekday } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useIsAccount } from "@/store/workspace";
import type { SetupFieldsProps } from "../types";

const PLANS: Plan[] = ["basic", "ultimate"];

type InitialPlanChoiceProps = {
  mode: "initial";
  selected: Plan | null;
  onSelect: (plan: Plan) => void;
  disabled?: boolean;
};
type WorkspacePlanChoiceProps = SetupFieldsProps & { mode?: "workspace" };

/** A plan's week in seven dots: Basic marks its one day (once chosen), Ultimate marks them all. */
export function PlanRhythm({ plan, day, tone = "light", className }: { plan: Plan; day: Weekday | null; tone?: "light" | "dark"; className?: string }) {
  const daily = plan === "ultimate";
  const on = tone === "dark" ? "bg-gold" : "bg-brown";
  const off = tone === "dark" ? "bg-cream/25" : "bg-stone";
  return (
    <span aria-hidden className={cn("flex items-center gap-1.5", className)}>
      {Array.from({ length: 7 }, (_, index) => {
        const call = daily || index === (day ?? -1);
        return <span key={index} className={cn("rounded-full transition-all duration-300", call ? `size-3 ${on}` : `size-1.5 ${off}`)} />;
      })}
    </span>
  );
}

/** The monthly price, large, with the VAT-inclusive amount underneath. Display only: nothing is charged. */
function PlanCardPrice({ plan }: { plan: Plan }) {
  const { m } = useI18n();
  const c = m.onboarding.plans;
  const price = MONTHLY_PLAN_PRICES_SAR[plan];
  const amount = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  return (
    <span className="mt-4 block">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <bdi className="whitespace-nowrap text-[1.75rem] font-semibold leading-none tabular-nums sm:text-[2rem]">
          {amount(price.beforeVat)} <span className="text-lg">{c.currency}</span>
        </bdi>
        <span className="text-[0.9375rem] text-muted">{c.perMonth}<span className="sr-only"> · {c.beforeVat}</span></span>
      </span>
      <span className="mt-2 block text-[0.875rem] text-muted">
        <bdi className="whitespace-nowrap tabular-nums">{amount(price.includingVat)} {c.currency}</bdi> {c.withVat(VAT_PERCENT)}
      </span>
    </span>
  );
}

/**
 * The plan as a choice between two weeks. In the demo the owner can switch; in an account the plan is
 * set by the NAQAH team, so only theirs is shown, read-only.
 */
export function PlanChoice(props: InitialPlanChoiceProps | WorkspacePlanChoiceProps) {
  const { m } = useI18n();
  const p = m.setup.plans;
  const c = m.onboarding.plans;
  const account = useIsAccount();
  const initial = props.mode === "initial";
  const ws = "ws" in props ? props.ws : null;
  const current = initial ? props.selected : ws!.settings.plan;
  const day = ws?.settings.callSchedule?.day ?? null;
  const tooManyForBasic = ws ? ws.settings.customQuestions.length > PLAN_LIMITS.basic.customQuestions : false;

  function choose(plan: Plan) {
    if (initial) {
      if (!props.disabled) props.onSelect(plan);
      return;
    }
    if (account || plan === current || (plan === "basic" && tooManyForBasic)) return;
    props.onChange((latest) => ({ ...latest, settings: { ...latest.settings, plan } }));
  }

  const card = (plan: Plan, selectable: boolean) => {
    const selected = plan === current;
    const blocked = plan === "basic" && tooManyForBasic && !selected;
    const body = (
      <>
        <span className="flex items-start justify-between gap-3">
          <span className="text-xl font-semibold">{m.common.plans[plan]}</span>
          {selectable ? (
            <span
              aria-hidden
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                selected ? "border-brown bg-brown text-cream" : "border-sand bg-cream",
              )}
            >
              {selected ? <Check size={13} weight="bold" className="naqah-done" /> : null}
            </span>
          ) : null}
        </span>
        {/* The price answers the first question; the week and two facts follow. */}
        <PlanCardPrice plan={plan} />
        <span className="mt-5 block border-t border-stone pt-4">
          <PlanRhythm plan={plan} day={day} className="h-3" />
          <span className="mt-3 block text-[1.0625rem] font-semibold leading-snug">{plan === "basic" ? c.basicRhythm : c.ultimateRhythm}</span>
          <span className="mt-1 block text-[0.9375rem] leading-relaxed text-muted">
            {plan === "basic"
              ? c.basicFacts(PLAN_LIMITS.basic.customQuestions, PLAN_LIMITS.basic.workers)
              : c.ultimateFacts(PLAN_LIMITS.ultimate.workers)}
          </span>
        </span>
        {blocked ? <span className="mt-2 block text-[0.9375rem] text-danger">{p.tooManyForBasic}</span> : null}
      </>
    );
    const frame = cn(
      "flex min-w-0 flex-col rounded-2xl border p-5 text-start sm:p-6 text-espresso transition-[border-color,background-color,box-shadow] duration-200",
      selected ? "border-brown bg-cream shadow-[inset_0_0_0_1px_var(--color-brown)]" : "border-stone bg-cream/60",
    );
    if (!selectable) return <div className={frame}>{body}</div>;
    return (
      <label
        className={cn(
          frame,
          "cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brown",
          !selected && !blocked && "hover:border-sand hover:bg-cream",
          blocked && "cursor-not-allowed opacity-70",
        )}
      >
        <input
          type="radio"
          name="plan"
          value={plan}
          className="sr-only"
          checked={selected}
          disabled={blocked || (initial && props.disabled === true)}
          onChange={() => choose(plan)}
        />
        {body}
      </label>
    );
  };

  return (
    <fieldset className="min-w-0">
      {/* On the plan page the heading already asks the question; the legend stays for screen readers. */}
      <legend className={initial ? "sr-only" : "mb-4 text-[1.0625rem] font-bold text-espresso"}>{p.choose}</legend>
      {!initial && account ? (
        <div className="grid gap-3">
          {card(ws!.settings.plan, false)}
          <p className="text-[0.9375rem] leading-relaxed text-muted">{p.change}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">{PLANS.map((plan) => <div key={plan} className="contents">{card(plan, true)}</div>)}</div>
          {initial ? null : <p className="text-[0.9375rem] leading-relaxed text-muted">{p.chooseDemo}</p>}
        </div>
      )}
    </fieldset>
  );
}
