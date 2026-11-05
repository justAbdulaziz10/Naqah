"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { Card, CardBody, CardHeader, Field, IconButton, Input, Segmented } from "@/components/ui";
import { uid } from "@/domain/id";
import type { Camel } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import type { SetupSectionProps } from "../types";

export function HerdSection({ ws, onChange, showErrors }: SetupSectionProps) {
  const { m } = useI18n();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [sex, setSex] = useState<Camel["sex"]>("female");
  const [age, setAge] = useState("");
  const hasStartedCamel = Boolean(name.trim() || tag.trim() || age);
  const nameMissing = showErrors && hasStartedCamel && !name.trim();
  const tagMissing = showErrors && hasStartedCamel && !tag.trim();
  const ageInvalid = age !== "" && (!/^\d+$/.test(age) || Number(age) > 100);

  function addCamel() {
    if (!name.trim() || !tag.trim() || ageInvalid) return;
    const camel: Camel = {
      id: uid("cml"),
      name: name.trim(),
      tag: tag.trim(),
      sex,
      ageYears: age ? Number(age) : null,
      health: "healthy",
      healthNote: null,
      certainty: "reported",
      updatedAt: null,
    };
    onChange((current) => ({ ...current, camels: [...current.camels, camel] }));
    setName("");
    setTag("");
    setSex("female");
    setAge("");
  }

  return (
    <Card>
      <CardHeader title={m.onboarding.sectionTitles.herd} />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={m.onboarding.camelName} error={nameMissing ? m.onboarding.requiredField : undefined}>
            {(id) => <Input id={id} value={name} aria-invalid={Boolean(nameMissing)} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label={m.onboarding.camelTag} error={tagMissing ? m.onboarding.requiredField : undefined}>
            {(id) => <Input id={id} className="ltr-nums text-start" value={tag} aria-invalid={Boolean(tagMissing)} onChange={(event) => setTag(event.target.value)} />}
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-semibold text-espresso">{m.onboarding.camelSex}</legend>
            <div>
              <Segmented
                value={sex}
                onChange={setSex}
                label={m.onboarding.camelSex}
                className="w-full [&>button]:min-h-11 [&>button]:flex-1"
                options={[
                  { value: "female", label: m.onboarding.female },
                  { value: "male", label: m.onboarding.male },
                ]}
              />
            </div>
          </fieldset>
          <Field label={m.onboarding.camelAge} error={ageInvalid ? m.onboarding.ageError : undefined}>
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                className="ltr-nums text-start"
                value={age}
                aria-invalid={ageInvalid}
                onChange={(event) => setAge(event.target.value)}
              />
            )}
          </Field>
        </div>
        <button
          type="button"
          onClick={addCamel}
          disabled={!name.trim() || !tag.trim() || ageInvalid}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-stone px-5 text-sm font-semibold text-espresso transition hover:border-sand hover:bg-ivory focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus size={18} weight="fill" aria-hidden />
          {m.onboarding.addCamel}
        </button>

        {ws.camels.length ? (
          <ul className="divide-y divide-stone/70 rounded-xl border border-stone/70">
            {ws.camels.map((camel) => (
              <li key={camel.id} className="flex min-h-16 items-center justify-between gap-3 px-3 py-2 sm:px-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-espresso">{camel.name}</p>
                  <p className="text-sm text-muted">
                    <span className="ltr-nums">{camel.tag}</span>
                    <span aria-hidden="true"> · </span>
                    {camel.sex === "female" ? m.onboarding.female : m.onboarding.male}
                    {camel.ageYears !== null ? <><span aria-hidden="true"> · </span><span className="ltr-nums">{camel.ageYears}</span> {m.onboarding.yearsOld}</> : null}
                  </p>
                </div>
                <IconButton
                  className="h-11 w-11 shrink-0"
                  label={m.onboarding.removeCamel(camel.name)}
                  onClick={() => onChange((current) => ({
                    ...current,
                    camels: current.camels.filter((item) => item.id !== camel.id),
                  }))}
                >
                  <Trash size={18} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-stone px-4 py-5 text-center">
            <p className="font-semibold text-espresso">{m.onboarding.herdEmpty}</p>
            <p className="mt-1 text-sm text-muted">{m.onboarding.herdEmptyBody}</p>
          </div>
        )}
        {showErrors && ws.camels.length === 0 ? (
          <p className="text-sm text-danger" role="alert">{m.onboarding.camelRequired}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
