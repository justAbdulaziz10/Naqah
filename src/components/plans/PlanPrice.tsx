import type { Plan } from "@/domain/types";
import { MONTHLY_PLAN_PRICES_SAR, VAT_PERCENT } from "@/domain/pricing";
import { cn } from "@/lib/cn";

type PriceCopy = {
  monthlyPerRanch: string;
  currency: string;
  beforeVat: string;
  includingVat: (percent: number) => string;
};

/** Display-only plan price; it does not initiate billing or imply a subscription. */
export function PlanPrice({
  plan,
  copy,
  tone = "light",
  compact = false,
  showLabel = true,
  className,
}: {
  plan: Plan;
  copy: PriceCopy;
  tone?: "light" | "dark";
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const price = MONTHLY_PLAN_PRICES_SAR[plan];
  const ink = tone === "dark" ? "text-cream" : "text-espresso";
  const muted = tone === "dark" ? "text-cream/70" : "text-muted";
  const amount = (value: number) => (
    <bdi className="whitespace-nowrap tabular-nums">
      {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} {copy.currency}
    </bdi>
  );

  return (
    <div className={cn("text-start", className)}>
      {showLabel ? <p className={cn(compact ? "text-xs" : "text-sm", muted)}>{copy.monthlyPerRanch}</p> : null}
      <p className={cn("font-semibold", ink, compact ? "text-sm" : "mt-1 text-2xl sm:text-3xl")}>
        {amount(price.beforeVat)}
        <span className={cn("ms-2 font-normal", compact ? "text-xs" : "text-sm", muted)}>{copy.beforeVat}</span>
      </p>
      <p className={cn(compact ? "mt-0.5 text-xs" : "mt-1 text-sm", muted)}>
        {amount(price.includingVat)} <span>· {copy.includingVat(VAT_PERCENT)}</span>
      </p>
    </div>
  );
}
