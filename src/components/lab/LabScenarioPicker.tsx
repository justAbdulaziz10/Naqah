"use client";

import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { scenarioMessageKey, type PickerScenario } from "./labStore";

const PICKER_SCENARIOS: PickerScenario[] = ["report_call", "worker_inbound", "worker_outbound", "emergency"];

/**
 * Which call to try. On a phone it is one compact row of chips (scrollable) so the phone stage and its
 * call button stay above the fold; on a wide screen the same choices sit as underlined tabs with a detail line.
 */
export function LabScenarioPicker({ selected, onSelect, sessionActive, m, plan }: {
  selected: PickerScenario;
  onSelect: (value: PickerScenario) => void;
  sessionActive: boolean;
  plan: Plan;
  m: ReturnType<typeof useI18n>["m"];
}) {
  const scenarios = PICKER_SCENARIOS.filter((scenario) => plan === "ultimate" || scenario !== "worker_outbound");
  return (
    <section aria-label={m.lab.title} className="space-y-2">
      <div
        role="radiogroup"
        aria-label={m.lab.title}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:gap-6 lg:overflow-visible lg:border-b lg:border-stone lg:pb-0"
      >
        {scenarios.map((scenario) => {
          const key = scenarioMessageKey(scenario);
          const current = selected === scenario;
          const disabled = sessionActive && !current;
          return (
            <button
              key={scenario}
              type="button"
              role="radio"
              aria-checked={current}
              disabled={disabled}
              onClick={() => onSelect(scenario)}
              className={cn(
                "min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown lg:-mb-px lg:min-h-0 lg:max-w-[16rem] lg:whitespace-normal lg:rounded-none lg:border-0 lg:border-b-2 lg:px-0 lg:pb-3.5 lg:pt-1 lg:text-start",
                current ? "border-espresso bg-espresso text-cream lg:border-brown lg:bg-transparent lg:text-espresso" : "border-stone bg-ivory text-muted hover:text-espresso lg:border-transparent",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="block leading-snug lg:text-base">{m.lab.scenarios[key].title}</span>
              <span className="mt-1 hidden text-xs font-normal leading-relaxed text-muted lg:block">{m.lab.scenarios[key].detail}</span>
            </button>
          );
        })}
      </div>
      <p className="text-sm leading-relaxed text-muted lg:hidden">{m.lab.scenarios[scenarioMessageKey(selected)].detail}</p>
    </section>
  );
}
