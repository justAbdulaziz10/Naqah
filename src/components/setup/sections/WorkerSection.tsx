"use client";

import { Card, CardBody, CardHeader, Field, Input, Select } from "@/components/ui";
import { WORKER_LANGUAGES } from "@/domain/catalog";
import { useI18n } from "@/i18n/client";
import type { SetupSectionProps } from "../types";

export function WorkerSection({ ws, onChange, showSaved, showErrors }: SetupSectionProps) {
  const { m, t } = useI18n();
  const worker = ws.settings.worker;

  return (
    <Card>
      <CardHeader
        title={m.onboarding.sectionTitles.worker}
        action={showSaved ? <span className="text-xs font-medium text-muted">{m.common.actions.saved}</span> : undefined}
      />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={m.onboarding.workerName} error={showErrors && !worker.name.trim() ? m.onboarding.requiredField : undefined}>
            {(id) => (
              <Input
                id={id}
                autoComplete="given-name"
                value={worker.name}
                aria-invalid={showErrors && !worker.name.trim()}
                onChange={(event) => onChange((current) => ({
                  ...current,
                  settings: { ...current.settings, worker: { ...current.settings.worker, name: event.target.value } },
                }))}
              />
            )}
          </Field>
          <Field label={m.onboarding.workerPhone} hint={m.onboarding.saudiPhoneHint} error={showErrors && !worker.phone.trim() ? m.onboarding.requiredField : undefined}>
            {(id) => (
              <Input
                id={id}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className="ltr-nums text-start"
                placeholder={m.onboarding.phonePlaceholder}
                value={worker.phone}
                aria-invalid={showErrors && !worker.phone.trim()}
                onChange={(event) => onChange((current) => ({
                  ...current,
                  settings: { ...current.settings, worker: { ...current.settings.worker, phone: event.target.value } },
                }))}
              />
            )}
          </Field>
        </div>
        <Field label={m.onboarding.workerLanguage}>
          {(id) => (
            <Select
              id={id}
              value={worker.language}
              onChange={(event) => onChange((current) => ({
                ...current,
                settings: { ...current.settings, worker: { ...current.settings.worker, language: event.target.value as typeof worker.language } },
              }))}
            >
              {WORKER_LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.native} · {t(language.label)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-sm text-muted">{m.onboarding.workerNoApp}</p>
      </CardBody>
    </Card>
  );
}
