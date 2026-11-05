"use client";

import { Card, CardBody, CardHeader, Field, Input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { SetupSectionProps } from "../types";

export function OwnerFarmSection({ ws, onChange, showSaved, showErrors }: SetupSectionProps) {
  const { m } = useI18n();
  const { owner, farm } = ws.settings;

  return (
    <Card>
      <CardHeader
        title={m.onboarding.sectionTitles.ownerFarm}
        action={showSaved ? <span className="text-xs font-medium text-muted">{m.common.actions.saved}</span> : undefined}
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label={m.onboarding.ownerName} error={showErrors && !owner.name.trim() ? m.onboarding.requiredField : undefined}>
          {(id) => (
            <Input
              id={id}
              autoComplete="name"
              value={owner.name}
              aria-invalid={showErrors && !owner.name.trim()}
              onChange={(event) => onChange((current) => ({
                ...current,
                settings: { ...current.settings, owner: { ...current.settings.owner, name: event.target.value } },
              }))}
            />
          )}
        </Field>
        <Field label={m.onboarding.ownerPhone} hint={m.onboarding.saudiPhoneHint} error={showErrors && !owner.phone.trim() ? m.onboarding.requiredField : undefined}>
          {(id) => (
            <Input
              id={id}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className="ltr-nums text-start"
              placeholder={m.onboarding.phonePlaceholder}
              value={owner.phone}
              aria-invalid={showErrors && !owner.phone.trim()}
              onChange={(event) => onChange((current) => ({
                ...current,
                settings: { ...current.settings, owner: { ...current.settings.owner, phone: event.target.value } },
              }))}
            />
          )}
        </Field>
        <Field label={m.onboarding.farmName} error={showErrors && !farm.name.trim() ? m.onboarding.requiredField : undefined}>
          {(id) => (
            <Input
              id={id}
              value={farm.name}
              aria-invalid={showErrors && !farm.name.trim()}
              onChange={(event) => onChange((current) => ({
                ...current,
                settings: { ...current.settings, farm: { ...current.settings.farm, name: event.target.value } },
              }))}
            />
          )}
        </Field>
        <Field label={m.onboarding.location} error={showErrors && !farm.location.trim() ? m.onboarding.requiredField : undefined}>
          {(id) => (
            <Input
              id={id}
              autoComplete="address-level2"
              value={farm.location}
              aria-invalid={showErrors && !farm.location.trim()}
              onChange={(event) => onChange((current) => ({
                ...current,
                settings: { ...current.settings, farm: { ...current.settings.farm, location: event.target.value } },
              }))}
            />
          )}
        </Field>
      </CardBody>
    </Card>
  );
}
