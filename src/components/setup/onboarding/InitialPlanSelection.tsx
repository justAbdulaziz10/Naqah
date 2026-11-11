"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { planSelectionResumePath } from "@/lib/account/plan-selection-paths";
import { selectInitialPlan } from "@/server/farm/actions";
import { Button } from "@/components/ui";
import { AuthFrame, AuthHeading } from "@/components/auth/AuthFrame";
import { PlanChoice } from "./PlanChoice";

type Props = { ownerId: string; existingFarm: boolean; next: string | null };

/** First-account setup: an explicit choice is saved before any ranch defaults are created. */
export function InitialPlanSelection({ ownerId, existingFarm, next }: Props) {
  const { locale, m } = useI18n();
  const copy = m.setup.plans.initial;
  const [selected, setSelected] = useState<Plan | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"save" | "limit" | "changed" | null>(null);
  const locked = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || locked.current) return;
    locked.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await selectInitialPlan(selected, ownerId);
      if (!result.ok) {
        setError(result.error === "conflict" ? "changed" : result.error === "limit_reached" ? "limit" : "save");
        return;
      }
      // Reloading lets the account boundary revalidate the current owner before loading their farm.
      window.location.assign(planSelectionResumePath(locale, false, next));
    } catch {
      setError("save");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return (
    <AuthFrame demoLink={false} wide>
      <AuthHeading title={m.onboarding.plans.title} lead={existingFarm ? copy.existingLead : m.onboarding.plans.lead} />
      <form onSubmit={(event) => void submit(event)} className="mt-7 flex flex-col gap-6" aria-busy={pending}>
        <PlanChoice mode="initial" selected={selected} onSelect={setSelected} disabled={pending || (error !== null && error !== "limit")} />
        {error ? (
          <p role="alert" className="text-sm leading-relaxed text-danger">
            {error === "limit" ? copy.limitReached : error === "changed" ? copy.changedAccount : copy.saveFailed}
          </p>
        ) : null}
        {error === "changed" || error === "save" ? <Button type="button" variant="ghost" onClick={() => window.location.reload()}>{copy.retry}</Button> : null}
        <Button type="submit" size="lg" className="naqah-press w-full" disabled={!selected || pending}>
          {pending ? copy.saving : copy.continue}
        </Button>
      </form>
    </AuthFrame>
  );
}
