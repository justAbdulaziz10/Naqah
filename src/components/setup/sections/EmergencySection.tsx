"use client";

import { Switch } from "@/components/ui";
import { EMERGENCY_LABELS } from "@/domain/catalog";
import type { EmergencyKind } from "@/domain/types";
import { uid } from "@/domain/id";
import { useI18n } from "@/i18n/client";
import { SaveState } from "../SaveState";
import type { SetupSectionProps } from "../types";
import { SettingsDisclosure } from "./SettingsDisclosure";

type StandardEmergency = Exclude<EmergencyKind, "custom">;

export function EmergencySection({ ws, onChange, showSaved }: SetupSectionProps) {
  const { m, t } = useI18n();
  const emergencies = Object.keys(EMERGENCY_LABELS) as StandardEmergency[];
  const chosen = emergencies.filter((kind) => ws.settings.emergencies.some((item) => item.kind === kind));

  function toggleEmergency(kind: EmergencyKind, enabled: boolean) {
    onChange((current) => {
      const found = current.settings.emergencies.find((item) => item.kind === kind);
      const next = enabled
        ? found ? current.settings.emergencies : [...current.settings.emergencies, { id: uid("emg"), kind, label: null }]
        : current.settings.emergencies.filter((item) => item.kind !== kind);
      return { ...current, settings: { ...current.settings, emergencies: next } };
    });
  }

  return (
    <SettingsDisclosure
      id="settings-emergencies"
      title={m.onboarding.emergenciesTitle}
      summary={chosen.length ? chosen.map((kind) => t(EMERGENCY_LABELS[kind])).join(" · ") : m.integrations.section.none}
      status={showSaved ? <SaveState /> : undefined}
    >
      <p className="text-sm leading-relaxed text-muted">{m.onboarding.emergencyNote}</p>
      <ul className="mt-2 divide-y divide-stone/70">
        {emergencies.map((kind) => {
          const label = t(EMERGENCY_LABELS[kind]);
          return (
            <li key={kind} className="flex min-h-14 items-center justify-between gap-4 py-2.5">
              <span className="font-medium text-espresso">{label}</span>
              <Switch
                className="after:absolute after:inset-y-[-8px] after:inset-x-[-4px] after:content-['']"
                checked={chosen.includes(kind)}
                label={label}
                onChange={(enabled) => toggleEmergency(kind, enabled)}
              />
            </li>
          );
        })}
      </ul>
    </SettingsDisclosure>
  );
}
