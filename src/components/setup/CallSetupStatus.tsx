"use client";

import type { ReportingWindow, Workspace } from "@/domain/types";
import { isValidWindow } from "@/domain/clock";
import { useI18n } from "@/i18n/client";
import { ButtonLink } from "@/components/ui";
import { useId } from "react";
import { isSaudiMobile } from "./phone";

export type CallSetupGap = "owner" | "farm" | "worker" | "schedule";

/** A window counts only once it has both times; a day alone, or an end with no start, is a draft. */
export function hasCompleteWindow(window: ReportingWindow | null): window is ReportingWindow {
  return Boolean(window && isValidWindow(window));
}

/** Configuration needed before a live call integration could use this farm. */
export function getCallSetupGaps(ws: Workspace): CallSetupGap[] {
  const gaps: CallSetupGap[] = [];
  const { owner, farm, worker, plan, window } = ws.settings;

  if (!owner.name.trim() || !isSaudiMobile(owner.phone)) gaps.push("owner");
  if (!farm.name.trim()) gaps.push("farm");
  if (!worker.name.trim() || !isSaudiMobile(worker.phone)) gaps.push("worker");
  if (plan === "basic" && !hasCompleteWindow(window)) gaps.push("schedule");

  return gaps;
}

/** Keeps saved setup completion separate from call configuration and live-call availability. */
export function CallSetupStatus({ ws, settingsHref }: { ws: Workspace; settingsHref?: string }) {
  const { m } = useI18n();
  const gaps = getCallSetupGaps(ws);
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl border border-stone/80 bg-cream px-4 py-4 sm:px-5"
    >
      <h2 id={titleId} className="font-bold text-espresso">
        {m.onboarding.callSetupTitle}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {gaps.length ? m.onboarding.callSetupIncomplete : m.onboarding.callSetupConfigured}
      </p>
      {gaps.length ? (
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-espresso">
          {gaps.map((gap) => <li key={gap}>{m.onboarding.callSetupItems[gap]}</li>)}
        </ul>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-muted">{m.onboarding.liveCallsUnavailable}</p>
      {settingsHref && gaps.length ? (
        <ButtonLink href={settingsHref} variant="secondary" className="mt-3 w-full sm:w-auto">
          {m.onboarding.completeSetupInSettings}
        </ButtonLink>
      ) : null}
    </section>
  );
}
