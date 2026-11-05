"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/components/ui";
import { WORKER_LANGUAGES } from "@/domain/catalog";
import { useI18n } from "@/i18n/client";
import { isLiveCallLanguage } from "@/lib/voice/liveCallLanguages";
import type { SetupSectionProps } from "../types";

interface PickedContact {
  name?: string[];
  tel?: string[];
}

interface ContactPicker {
  select: (properties: ("name" | "tel")[], options?: { multiple?: boolean }) => Promise<PickedContact[]>;
}

type NavigatorWithContacts = Navigator & { contacts?: ContactPicker };

export function WorkerSection({ ws, onChange, showSaved, showErrors }: SetupSectionProps) {
  const { m, t } = useI18n();
  const worker = ws.settings.worker;
  const [contactPickerAvailable, setContactPickerAvailable] = useState(false);
  const selectedLanguage = WORKER_LANGUAGES.find((language) => language.id === worker.language) ?? WORKER_LANGUAGES[0];
  const liveLanguages = WORKER_LANGUAGES.filter((language) => isLiveCallLanguage(language.id));
  const laterLanguages = WORKER_LANGUAGES.filter((language) => !isLiveCallLanguage(language.id));
  const languageOption = (language: (typeof WORKER_LANGUAGES)[number]) => (
    <option key={language.id} value={language.id}>
      {language.native} · {t(language.label)}
    </option>
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      const contacts = typeof navigator === "undefined" ? undefined : (navigator as NavigatorWithContacts).contacts;
      if (active) setContactPickerAvailable(typeof contacts?.select === "function");
    });
    return () => { active = false; };
  }, []);

  async function chooseContact() {
    const contacts = typeof navigator === "undefined" ? undefined : (navigator as NavigatorWithContacts).contacts;
    if (typeof contacts?.select !== "function") return;

    try {
      const [contact] = await contacts.select(["name", "tel"], { multiple: false });
      const name = contact?.name?.[0]?.trim();
      const phone = contact?.tel?.[0]?.trim();
      if (!name && !phone) return;
      onChange((current) => ({
        ...current,
        settings: {
          ...current.settings,
          worker: {
            ...current.settings.worker,
            ...(name ? { name } : {}),
            ...(phone ? { phone } : {}),
          },
        },
      }));
    } catch {
      // The picker can be dismissed without selecting a contact.
    }
  }

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
        {contactPickerAvailable ? (
          <Button variant="secondary" className="min-h-11" onClick={chooseContact}>
            {m.integrations.weather.chooseFromContacts}
          </Button>
        ) : null}
        <Field
          label={m.onboarding.workerLanguage}
          hint={isLiveCallLanguage(worker.language) ? m.onboarding.workerLanguageLive : m.onboarding.workerLanguageNotLive(t(selectedLanguage.label))}
        >
          {(id) => (
            <Select
              id={id}
              value={worker.language}
              onChange={(event) => onChange((current) => ({
                ...current,
                settings: { ...current.settings, worker: { ...current.settings.worker, language: event.target.value as typeof worker.language } },
              }))}
            >
              <optgroup label={m.onboarding.liveCallLanguages}>
                {liveLanguages.map(languageOption)}
              </optgroup>
              <optgroup label={m.onboarding.laterCallLanguages}>
                {laterLanguages.map(languageOption)}
              </optgroup>
            </Select>
          )}
        </Field>
        <p className="text-sm text-muted">{m.onboarding.workerNoApp}</p>
      </CardBody>
    </Card>
  );
}
