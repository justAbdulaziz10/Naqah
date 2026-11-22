"use client";

import type { Plan } from "@/domain/types";
import { Segmented } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { scenarioMessageKey, type PickerScenario } from "./labStore";

const PICKER_SCENARIOS: PickerScenario[] = ["report_call", "worker_inbound", "worker_outbound", "emergency"];

/**
 * Which call to try: the shared Segmented control, one row at every width. On a phone the row scrolls
 * sideways under an edge fade instead of clipping; the chosen scenario's detail sits beneath.
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
      <div className="relative max-w-full sm:w-fit">
        <Segmented
          label={m.lab.title}
          value={selected}
          onChange={onSelect}
          className="max-w-full"
          options={scenarios.map((scenario) => ({
            value: scenario,
            label: m.lab.scenarios[scenarioMessageKey(scenario)].title,
            disabled: sessionActive && scenario !== selected,
          }))}
        />
        {/* A quiet fade at the far edge says the row continues; it lifts once the row fits. */}
        <span aria-hidden className="pointer-events-none absolute inset-y-px end-px w-8 rounded-e-full bg-linear-to-r from-transparent to-ivory rtl:bg-linear-to-l sm:hidden" />
      </div>
      <p className="text-sm leading-relaxed text-muted">{m.lab.scenarios[scenarioMessageKey(selected)].detail}</p>
    </section>
  );
}
