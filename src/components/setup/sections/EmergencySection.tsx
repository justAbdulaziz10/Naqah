"use client";

import { Card, CardBody, CardHeader, Switch } from "@/components/ui";
import { EMERGENCY_LABELS } from "@/domain/catalog";
import type { EmergencyKind } from "@/domain/types";
import { uid } from "@/domain/id";
import { useI18n } from "@/i18n/client";
import { SaveState } from "../SaveState";
import type { SetupSectionProps } from "../types";

type StandardEmergency = Exclude<EmergencyKind, "custom">;

export function EmergencySection({ ws, onChange, showSaved }: SetupSectionProps) {
  const { m, t } = useI18n();
  const emergencies = Object.keys(EMERGENCY_LABELS) as StandardEmergency[];

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
    <Card>
      <CardHeader
        title={m.onboarding.emergenciesTitle}
        action={showSaved ? <SaveState /> : undefined}
      />
      <CardBody>
        <ul className="divide-y divide-stone/70">
          {emergencies.map((kind) => {
            const label = t(EMERGENCY_LABELS[kind]);
            const selected = ws.settings.emergencies.some((item) => item.kind === kind);
            return (
              <li key={kind} className="flex min-h-16 items-center justify-between gap-4 py-3">
                <span className="font-medium text-espresso">{label}</span>
                <Switch
                  className="after:absolute after:inset-y-[-8px] after:inset-x-[-4px] after:content-['']"
                  checked={selected}
                  label={label}
                  onChange={(enabled) => toggleEmergency(kind, enabled)}
                />
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-muted">{m.onboarding.emergencyNote}</p>
      </CardBody>
    </Card>
  );
}
