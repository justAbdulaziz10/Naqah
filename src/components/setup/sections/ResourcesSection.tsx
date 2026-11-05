"use client";

import { Card, CardBody, CardHeader, Switch } from "@/components/ui";
import { RESOURCE_KINDS, RESOURCE_LABELS } from "@/domain/catalog";
import { useI18n } from "@/i18n/client";
import type { SetupSectionProps } from "../types";

export function ResourcesSection({ ws, onChange, showSaved }: SetupSectionProps) {
  const { m, t } = useI18n();

  return (
    <Card>
      <CardHeader
        title={m.onboarding.sectionTitles.resources}
        action={showSaved ? <span className="text-xs font-medium text-muted">{m.common.actions.saved}</span> : undefined}
      />
      <CardBody>
        <ul className="divide-y divide-stone/70">
          {RESOURCE_KINDS.map((kind) => {
            const resource = ws.resources.find((item) => item.kind === kind);
            if (!resource) return null;
            const label = t(RESOURCE_LABELS[kind]);
            return (
              <li key={kind} className="flex min-h-16 items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-semibold text-espresso">{label}</p>
                  <p className="text-sm text-muted">{resource.present ? m.onboarding.presentOnFarm : m.onboarding.absentFromFarm}</p>
                </div>
                <Switch
                  className="after:absolute after:inset-y-[-8px] after:inset-x-[-4px] after:content-['']"
                  checked={resource.present}
                  label={`${label} — ${m.onboarding.hasResource}`}
                  onChange={(present) => onChange((current) => ({
                    ...current,
                    resources: current.resources.map((item) => item.kind === kind ? { ...item, present } : item),
                  }))}
                />
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm text-muted">{m.onboarding.absentResourcesSkipped}</p>
      </CardBody>
    </Card>
  );
}
