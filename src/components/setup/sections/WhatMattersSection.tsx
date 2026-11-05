"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { Card, CardBody, CardHeader, Field, IconButton, Input, Switch } from "@/components/ui";
import { CRITERION_LABELS, EMERGENCY_LABELS } from "@/domain/catalog";
import { uid } from "@/domain/id";
import type { CriterionKind, EmergencyKind } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import type { SetupSectionProps } from "../types";

type StandardCriterion = Exclude<CriterionKind, "custom">;
type StandardEmergency = Exclude<EmergencyKind, "custom">;

export function WhatMattersSection({ ws, onChange, showSaved }: SetupSectionProps) {
  const { m, t } = useI18n();
  const [customLabel, setCustomLabel] = useState("");
  const criteria = Object.keys(CRITERION_LABELS) as StandardCriterion[];
  const emergencies = Object.keys(EMERGENCY_LABELS) as StandardEmergency[];

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

  function toggleEmergency(kind: EmergencyKind, enabled: boolean) {
    onChange((current) => {
      const found = current.settings.emergencies.find((item) => item.kind === kind);
      const emergenciesNext = enabled
        ? found ? current.settings.emergencies : [...current.settings.emergencies, { id: uid("emg"), kind, label: null }]
        : current.settings.emergencies.filter((item) => item.kind !== kind);
      return { ...current, settings: { ...current.settings, emergencies: emergenciesNext } };
    });
  }

  return (
    <Card>
      <CardHeader
        title={m.onboarding.sectionTitles.whatMatters}
        action={showSaved ? <span className="text-xs font-medium text-muted">{m.common.actions.saved}</span> : undefined}
      />
      <CardBody className="space-y-6">
        <section>
          <h3 className="font-semibold text-espresso">{m.onboarding.criteriaTitle}</h3>
          <ul className="mt-2 divide-y divide-stone/70">
            {criteria.map((kind) => {
              const criterion = ws.settings.criteria.find((item) => item.kind === kind);
              const label = t(CRITERION_LABELS[kind]);
              return (
                <li key={kind} className="flex min-h-16 items-center justify-between gap-4 py-3">
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
                <li key={criterion.id} className="flex min-h-16 items-center justify-between gap-3 py-3">
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
          <div className="mt-3 flex items-end gap-2">
            <Field label={m.onboarding.customCriterion} className="min-w-0 flex-1">
              {(id) => <Input id={id} value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} />}
            </Field>
            <button
              type="button"
              onClick={addCustomCriterion}
              disabled={!customLabel.trim()}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-stone px-4 text-sm font-semibold text-espresso transition hover:border-sand hover:bg-ivory focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Plus size={18} weight="fill" aria-hidden />
              <span>{m.common.actions.add}</span>
            </button>
          </div>
        </section>

        <section>
          <h3 className="font-semibold text-espresso">{m.onboarding.emergenciesTitle}</h3>
          <ul className="mt-2 divide-y divide-stone/70">
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
          <p className="mt-4 rounded-xl bg-ivory px-4 py-3 text-sm leading-relaxed text-muted">{m.onboarding.emergencyNote}</p>
        </section>
      </CardBody>
    </Card>
  );
}
