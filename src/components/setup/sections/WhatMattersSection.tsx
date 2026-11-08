"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { Card, CardBody, CardHeader, Field, IconButton, Input, Switch } from "@/components/ui";
import { CRITERION_LABELS } from "@/domain/catalog";
import { uid } from "@/domain/id";
import type { CriterionKind } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { SaveState } from "../SaveState";
import type { SetupSectionProps } from "../types";

type StandardCriterion = Exclude<CriterionKind, "custom">;

export function WhatMattersSection({ ws, onChange, showSaved }: SetupSectionProps) {
  const { m, t } = useI18n();
  const [customLabel, setCustomLabel] = useState("");
  const criteria = Object.keys(CRITERION_LABELS) as StandardCriterion[];

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
    <Card>
      <CardHeader
        title={m.onboarding.sectionTitles.whatMatters}
        action={showSaved ? <SaveState /> : undefined}
      />
      <CardBody>
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
      </CardBody>
    </Card>
  );
}
