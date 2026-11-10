"use client";

import { Segmented } from "@/components/ui";
import { reportModeOf } from "@/domain/rules";
import type { ReportMode } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import type { SetupFieldsProps } from "../types";

const MODES: ReportMode[] = ["worker_choice", "guided", "open"];

/** How the worker gives the report. Shared by setup and Settings. */
export function ReportModeField({ ws, onChange }: SetupFieldsProps) {
  const { m } = useI18n();
  const c = m.setup.questions.mode;
  const mode = reportModeOf(ws);
  return (
    <div className="mt-1 border-b border-stone/70 pb-8">
      <h3 className="text-[1.0625rem] font-bold text-espresso">{c.title}</h3>
      <Segmented
        label={c.title}
        value={mode}
        onChange={(reportMode) => onChange((current) => ({ ...current, settings: { ...current.settings, reportMode } }))}
        options={MODES.map((value) => ({ value, label: c.options[value] }))}
        className="mt-3 w-full [&>button]:flex-auto [&>button]:px-1.5 max-sm:[&>button]:text-[0.8125rem] sm:[&>button]:px-4"
      />
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">{c.detail[mode]}</p>
      {mode === "guided" ? null : <p className="mt-1 text-sm leading-relaxed text-muted">{c.realtimeNote}</p>}
    </div>
  );
}
