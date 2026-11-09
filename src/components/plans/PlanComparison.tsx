"use client";

import { PLAN_LIMITS } from "@/domain/catalog";
import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { PlanPrice } from "@/components/plans/PlanPrice";
import { cn } from "@/lib/cn";

const PLANS: Plan[] = ["basic", "ultimate"];

/**
 * Basic next to Ultimate, with the owner's plan marked. Read-only: plans are changed by the NAQAH
 * team, never from here. Prices are shown for reference only; billing is not implemented.
 */
export function PlanComparison({ current, className }: { current: Plan; className?: string }) {
  const { m } = useI18n();
  const p = m.setup.plans;
  const rows: { key: string; label: string; value: (plan: Plan) => string }[] = [
    { key: "workers", label: p.workers, value: (plan) => p.upTo(PLAN_LIMITS[plan].workers) },
    { key: "call", label: p.reportCall, value: (plan) => (PLAN_LIMITS[plan].reports === "weekly" ? p.weekly : p.daily) },
    {
      key: "questions",
      label: p.questions,
      value: (plan) => (Number.isFinite(PLAN_LIMITS[plan].customQuestions) ? p.upTo(PLAN_LIMITS[plan].customQuestions) : p.noLimit),
    },
    { key: "tasks", label: p.tasks, value: (plan) => (PLAN_LIMITS[plan].taskTickets ? p.included : p.notIncluded) },
    { key: "owner", label: p.ownerCalls, value: (plan) => (Number.isFinite(PLAN_LIMITS[plan].ownerCalls) ? p.weekly : p.anyTime) },
  ];

  return (
    <div className={className}>
      <table className="w-full table-fixed border-collapse text-start text-[0.9375rem]">
        <caption className="sr-only">{p.caption}</caption>
        <thead>
          <tr className="border-b border-stone/80">
            <td className="w-[38%] pb-3" />
            {PLANS.map((plan) => (
              <th key={plan} scope="col" className="pb-3 text-start align-bottom">
                <span className="block text-base font-bold text-espresso">{m.common.plans[plan]}</span>
                {plan === current ? <span className="mt-0.5 block text-sm font-semibold text-brown">{p.yours}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone/60">
          <tr>
            <th scope="row" className="py-3 pe-3 text-start font-medium text-muted">{p.price.monthlyPerRanch}</th>
            {PLANS.map((plan) => (
              <td key={plan} className={cn("py-3 pe-2 leading-snug", plan === current ? "font-semibold text-espresso" : "text-espresso/80")}>
                <PlanPrice plan={plan} copy={p.price} compact showLabel={false} />
              </td>
            ))}
          </tr>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="py-3 pe-3 text-start font-medium text-muted">{row.label}</th>
              {PLANS.map((plan) => (
                <td key={plan} className={cn("py-3 pe-2 leading-snug", plan === current ? "font-semibold text-espresso" : "text-espresso/80")}>
                  {row.value(plan)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm leading-relaxed text-muted">{p.change}</p>
    </div>
  );
}
