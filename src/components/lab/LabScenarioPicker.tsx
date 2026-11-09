"use client";

import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { scenarioMessageKey, type PickerScenario } from "./labStore";

const PICKER_SCENARIOS: PickerScenario[] = ["report_call", "worker_inbound", "worker_outbound", "owner_inquiry", "emergency"];

export function LabScenarioPicker({ selected, onSelect, sessionActive, m, plan }: {
  selected: PickerScenario;
  onSelect: (value: PickerScenario) => void;
  sessionActive: boolean;
  plan: Plan;
  m: ReturnType<typeof useI18n>["m"];
}) {
  return (
    <section aria-label={m.lab.title} className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5 lg:gap-6 lg:border-b lg:border-stone">
        {PICKER_SCENARIOS.filter((scenario) => plan === "ultimate" || scenario !== "worker_outbound").map((scenario) => {
          const key = scenarioMessageKey(scenario);
          const current = selected === scenario;
          const disabled = sessionActive && !current;
          return (
            <button
              key={scenario}
              type="button"
              aria-pressed={current}
              disabled={disabled}
              onClick={() => onSelect(scenario)}
              className={cn(
                "min-h-16 rounded-xl border px-3 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown lg:-mb-px lg:min-h-0 lg:rounded-none lg:border-0 lg:border-b-2 lg:px-0 lg:pb-3.5 lg:pt-1",
                current ? "border-brown bg-cream text-espresso lg:bg-transparent" : "border-stone text-muted hover:text-espresso lg:border-transparent",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="block text-sm font-semibold leading-snug lg:text-base">{m.lab.scenarios[key].title}</span>
              <span className="mt-1 hidden text-xs leading-relaxed text-muted lg:block">{m.lab.scenarios[key].detail}</span>
            </button>
          );
        })}
      </div>
      <p className="text-sm leading-relaxed text-muted lg:hidden">{m.lab.scenarios[scenarioMessageKey(selected)].detail}</p>
    </section>
  );
}
