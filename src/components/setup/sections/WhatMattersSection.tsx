"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { Field, IconButton, Input, Switch } from "@/components/ui";
import { CRITERION_LABELS } from "@/domain/catalog";
import { uid } from "@/domain/id";
import type { CriterionKind } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { SaveState } from "../SaveState";
import type { SetupSectionProps } from "../types";
import { SettingsDisclosure } from "./SettingsDisclosure";

type StandardCriterion = Exclude<CriterionKind, "custom">;

export function WhatMattersSection({ ws, onChange, showSaved }: SetupSectionProps) {
  const { m, t } = useI18n();
  const [customLabel, setCustomLabel] = useState("");
  const criteria = Object.keys(CRITERION_LABELS) as StandardCriterion[];
  const enabledLabels = ws.settings.criteria
    .filter((item) => item.enabled)
    .map((item) => item.kind === "custom" ? item.label ?? "" : t(CRITERION_LABELS[item.kind]))
    .filter(Boolean);

  function toggleCriterion(kind: CriterionKind, enabled: boolean) {
    onChange((current) => {
      const found = current.settings.criteria.some((item) => item.kind === kind);
      return {
        ...current,
        settings: {
          ...current.settings,
          criteria: found
            ? current.settings.criteria.map((item) => item.kind === kind ? { ...item, enabled } : item)
            : [...current.settings.criteria, { id: uid("crt"), kind, label: null, enabled }],
        },
      };
    });
  }

  function addCustomCriterion() {
    const label = customLabel.trim();
    if (!label) return;
    onChange((current) => ({
      ...current,
      settings: {
        ...current.settings,
        criteria: [...current.settings.criteria, { id: uid("crt"), kind: "custom", label, enabled: true }],
      },
    }));
    setCustomLabel("");
  }

  return (
    <SettingsDisclosure
      id="settings-criteria"
      title={m.onboarding.sectionTitles.whatMatters}
      summary={enabledLabels.length ? enabledLabels.join(" · ") : m.integrations.section.none}
      status={showSaved ? <SaveState /> : undefined}
    >
        <section aria-label={m.onboarding.criteriaTitle}>
          <ul className="divide-y divide-stone/70">
            {criteria.map((kind) => {
              const criterion = ws.settings.criteria.find((item) => item.kind === kind);
              const label = t(CRITERION_LABELS[kind]);
              return (
                <li key={kind} className="flex min-h-14 items-center justify-between gap-4 py-2.5">
                  <span className="font-medium text-espresso">{label}</span>
                  <Switch
                    className="after:absolute after:inset-y-[-8px] after:inset-x-[-4px] after:content-['']"
                    checked={criterion?.enabled ?? false}
                    label={label}
                    onChange={(enabled) => toggleCriterion(kind, enabled)}
                  />
                </li>
              );
            })}
            {ws.settings.criteria.filter((item) => item.kind === "custom").map((criterion) => {
              const label = criterion.label ?? "";
              return (
                <li key={criterion.id} className="flex min-h-14 items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 flex-1 font-medium text-espresso">{label}</span>
                  <Switch
                    className="after:absolute after:inset-y-[-8px] after:inset-x-[-4px] after:content-['']"
                    checked={criterion.enabled}
                    label={label}
                    onChange={(enabled) => onChange((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        criteria: current.settings.criteria.map((item) => item.id === criterion.id ? { ...item, enabled } : item),
                      },
                    }))}
                  />
                  <IconButton
                    className="h-11 w-11 shrink-0"
                    label={m.onboarding.removeCustomCriterion(label)}
                    onClick={() => onChange((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        criteria: current.settings.criteria.filter((item) => item.id !== criterion.id),
                      },
                    }))}
                  >
                    <Trash size={18} aria-hidden />
                  </IconButton>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex max-w-xl items-end gap-2">
            <Field label={m.onboarding.customCriterion} className="min-w-0 flex-1">
              {(id) => <Input id={id} value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} />}
            </Field>
            <button
              type="button"
              onClick={addCustomCriterion}
              disabled={!customLabel.trim()}
              className="naqah-press inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-stone bg-cream px-5 font-semibold text-espresso transition hover:border-sand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:text-muted"
            >
              <Plus size={18} weight="bold" aria-hidden />
              <span>{m.common.actions.add}</span>
            </button>
          </div>
        </section>
    </SettingsDisclosure>
  );
}
