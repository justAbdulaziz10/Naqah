"use client";

import { Switch } from "@/components/ui";
import { RESOURCE_KINDS, RESOURCE_LABELS } from "@/domain/catalog";
import { useI18n } from "@/i18n/client";
import { SaveState } from "../SaveState";
import type { SetupSectionProps } from "../types";
import { SettingsDisclosure } from "./SettingsDisclosure";

export function ResourcesSection({ ws, onChange, showSaved }: SetupSectionProps) {
  const { m, t } = useI18n();
  const present = RESOURCE_KINDS.filter((kind) => ws.resources.some((item) => item.kind === kind && item.present));

  return (
    <SettingsDisclosure
      id="settings-resources"
      title={m.onboarding.sectionTitles.resources}
      summary={present.length ? present.map((kind) => t(RESOURCE_LABELS[kind])).join(" · ") : m.integrations.section.none}
      status={showSaved ? <SaveState /> : undefined}
    >
      <ul className="divide-y divide-stone/70">
        {RESOURCE_KINDS.map((kind) => {
          const resource = ws.resources.find((item) => item.kind === kind);
          if (!resource) return null;
          const label = t(RESOURCE_LABELS[kind]);
          return (
            <li key={kind} className="flex min-h-14 items-center justify-between gap-4 py-2.5">
              <span className="font-medium text-espresso">{label}</span>
              <Switch
                className="after:absolute after:inset-y-[-8px] after:inset-x-[-4px] after:content-['']"
                checked={resource.present}
                label={`${label} — ${m.onboarding.hasResource}`}
                onChange={(next) => onChange((current) => ({
                  ...current,
                  resources: current.resources.map((item) => item.kind === kind ? { ...item, present: next } : item),
                }))}
              />
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-muted">{m.onboarding.absentResourcesSkipped}</p>
    </SettingsDisclosure>
  );
}
