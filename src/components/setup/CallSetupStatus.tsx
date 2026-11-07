"use client";

import { useId } from "react";
import { ButtonLink } from "@/components/ui";
import { isCompleteCallSchedule } from "@/domain/schedule";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { isLiveCallLanguage } from "@/lib/voice/liveCallLanguages";
import { isSaudiMobile } from "./phone";

export type CallSetupGap = "owner" | "farm" | "worker" | "schedule";

/** What NAQAH still needs before it could call: the owner, the ranch name, the called worker and the call time. */
export function getCallSetupGaps(ws: Workspace): CallSetupGap[] {
  const gaps: CallSetupGap[] = [];
  const { owner, farm, worker, plan, callSchedule } = ws.settings;

  if (!owner.name.trim() || !isSaudiMobile(owner.phone)) gaps.push("owner");
  if (!farm.name.trim()) gaps.push("farm");
  if (!worker.name.trim() || !isSaudiMobile(worker.phone)) gaps.push("worker");
  if (!isCompleteCallSchedule(plan, callSchedule)) gaps.push("schedule");

  return gaps;
}

/** The worker's language is saved, but calls will not run in it yet. Not a gap: calls still work. */
export function hasCallLanguageNote(ws: Workspace): boolean {
  return !isLiveCallLanguage(ws.settings.worker.language);
}

/** Shown on the dashboard only while something calls need is missing. The header links to Settings. */
export function CallSetupStatus({ ws }: { ws: Workspace }) {
  const { m, href } = useI18n();
  const gaps = getCallSetupGaps(ws);
  const titleId = useId();
  if (!gaps.length) return null;

  return (
    <section aria-labelledby={titleId} className="rounded-[var(--radius-card)] border border-stone/70 bg-cream px-5 py-5 sm:px-8">
      <h2 id={titleId} className="text-lg font-semibold text-espresso">{m.setup.gaps.title}</h2>
      <p className="mt-1 text-muted">{m.setup.gaps.lead}</p>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-espresso">
        {gaps.map((gap) => <li key={gap}>{m.setup.ready.missing[gap]}</li>)}
      </ul>
      <ButtonLink href={href("/app/settings")} className="mt-5 w-full sm:w-auto">{m.setup.gaps.action}</ButtonLink>
    </section>
  );
}
