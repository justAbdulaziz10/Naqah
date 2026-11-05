"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { formatSaudiMobile, phoneNeedsFixing } from "../phone";

/** Settings phone field: tidies a valid number and flags a wrong one when the owner leaves the field. */
export function PhoneInput({
  label,
  value,
  onChange,
  autoComplete = "tel",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  const { m } = useI18n();
  const [touched, setTouched] = useState(() => phoneNeedsFixing(value));
  const invalid = touched && phoneNeedsFixing(value);
  return (
    <Field
      label={label}
      hint={`${m.onboarding.optional} · ${m.onboarding.saudiPhoneHint}`}
      error={invalid ? <>{m.onboarding.wizard.phoneCheck} <bdi className="ltr-nums whitespace-nowrap">{m.onboarding.wizard.phoneExample}</bdi></> : undefined}
    >
      {(id) => (
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          dir="ltr"
          className={`ltr-nums text-left rtl:text-right${invalid ? " border-danger" : ""}`}
          aria-invalid={invalid || undefined}
          placeholder={m.onboarding.phonePlaceholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            setTouched(true);
            const formatted = formatSaudiMobile(value);
            if (formatted !== value) onChange(formatted);
          }}
        />
      )}
    </Field>
  );
}
