"use client";

import { useId } from "react";
import { reportModeOf } from "@/domain/rules";
import type { ReportMode } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import type { SetupFieldsProps } from "../types";

const MODES: ReportMode[] = ["worker_choice", "guided", "open"];
/** Set at build time for the local natural-voice demo (test-call-local.mjs --natural). */
const NATURAL_CALLS = process.env.NEXT_PUBLIC_NAQAH_NATURAL_CALLS === "1";

/** How the worker gives the report: three separate choices, each with its one-line meaning. Shared by setup and Settings. */
export function ReportModeField({ ws, onChange }: SetupFieldsProps) {
  const { m } = useI18n();
  const name = useId();
  // A natural call is one conversation over the owner's questions: there is no way of reporting to choose.
  // The stored mode stays as it was, for builds that still offer the choice.
  if (NATURAL_CALLS) return null;
  const c = m.setup.questions.mode;
  const mode = reportModeOf(ws);
  return (
    <fieldset className="mt-1 border-b border-stone/70 pb-8">
      <legend className="text-[1.0625rem] font-bold text-espresso">{c.title}</legend>
      <div className="mt-3 space-y-2">
        {MODES.map((value) => {
          const selected = value === mode;
          return (
            <label
              key={value}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brown",
                selected ? "border-brown ring-1 ring-brown" : "border-stone hover:border-sand",
              )}
            >
              <input
                type="radio"
                name={name}
                value={value}
                checked={selected}
                onChange={() => onChange((current) => ({ ...current, settings: { ...current.settings, reportMode: value } }))}
                className="mt-1 size-[1.125rem] shrink-0 accent-brown focus-visible:outline-none"
              />
              <span className="min-w-0">
                <span className={cn("block leading-snug text-espresso", selected && "font-semibold")}>{c.options[value]}</span>
                <span className="mt-0.5 block text-[0.9375rem] leading-relaxed text-muted">{c.detail[value]}</span>
              </span>
            </label>
          );
        })}
      </div>
      {mode === "guided" ? null : <p className="mt-3 text-sm leading-relaxed text-muted">{c.realtimeNote}</p>}
    </fieldset>
  );
}
