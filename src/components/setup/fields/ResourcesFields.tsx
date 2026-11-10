"use client";

import { RESOURCE_KINDS, RESOURCE_LABELS } from "@/domain/catalog";
import { useI18n } from "@/i18n/client";
import type { SetupFieldsProps } from "../types";
import { ChoiceRow, FieldGroup } from "../onboarding/WizardParts";

/** What the ranch has. NAQAH asks only about what is ticked. Onboarding; Settings keeps its switch list. */
export function ResourcesFields({ ws, onChange }: SetupFieldsProps) {
  const { m, t } = useI18n();
  const r = m.setup.resources;
  return (
    <FieldGroup title={r.title}>
      <p className="-mt-2 mb-4 text-[0.9375rem] leading-relaxed text-muted">{r.lead}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {RESOURCE_KINDS.map((kind) => {
          const resource = ws.resources.find((item) => item.kind === kind);
          if (!resource) return null;
          return (
            <ChoiceRow
              key={kind}
              checked={resource.present}
              label={t(RESOURCE_LABELS[kind])}
              onChange={(present) => onChange((current) => ({
                ...current,
                resources: current.resources.map((item) => (item.kind === kind ? { ...item, present } : item)),
              }))}
            />
          );
        })}
      </div>
    </FieldGroup>
  );
}
