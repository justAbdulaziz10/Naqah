"use client";

import { Check } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";
import { useId, useState } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { formatSaudiMobile, phoneNeedsFixing } from "../phone";

/**
 * Onboarding-only form pieces. They are set larger than the shared Field/Input (17px text, 56px
 * controls) for older owners filling the form on a phone outdoors. Settings keeps the shared ones.
 */

export const wizardControl =
  "h-14 w-full rounded-xl border border-stone bg-white px-4 text-[1.0625rem] text-espresso placeholder:text-muted transition focus:border-brown focus:outline-none focus:ring-4 focus:ring-brown/15 disabled:bg-ivory disabled:text-muted";

export function StepField({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-[0.975rem] font-semibold text-espresso">
        {label}
      </label>
      {children({ id, describedBy: note ? noteId : undefined, invalid: Boolean(error) })}
      {error ? (
        <p id={noteId} className="text-[0.9375rem] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-[0.9375rem] leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function StepInput({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(wizardControl, className)} {...props} />;
}

export function StepSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(wizardControl, "appearance-none pe-11")} {...props}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M3.5 6 8 10.5 12.5 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Phone input that always reads left-to-right, and tidies or flags the number once the owner leaves it. */
export function PhoneField({
  label,
  value,
  onChange,
  autoComplete = "tel",
  showError = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  showError?: boolean;
  /** Replaces the format hint; `null` shows none (e.g. on repeated rows). */
  hint?: ReactNode | null;
}) {
  const { m } = useI18n();
  const [touched, setTouched] = useState(() => phoneNeedsFixing(value));
  const invalid = (touched || showError) && phoneNeedsFixing(value);
  return (
    <StepField
      label={label}
      error={invalid ? <>{m.onboarding.wizard.phoneCheck} <bdi className="ltr-nums whitespace-nowrap">{m.onboarding.wizard.phoneExample}</bdi></> : undefined}
      hint={hint === undefined ? (
        <>
          {m.onboarding.wizard.phoneHint} <bdi className="ltr-nums whitespace-nowrap font-medium text-espresso">{m.onboarding.wizard.phoneExample}</bdi>
        </>
      ) : hint ?? undefined}
    >
      {({ id, describedBy }) => (
        <StepInput
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          dir="ltr"
          className={cn("text-left tracking-wide rtl:text-right", invalid && "border-danger")}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            setTouched(true);
            const formatted = formatSaudiMobile(value);
            if (formatted !== value) onChange(formatted);
          }}
        />
      )}
    </StepField>
  );
}

/** A group of related fields with a quiet heading. */
export function FieldGroup({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-4 text-[1.0625rem] font-bold text-espresso">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * A tickable row: icon, label and a check. A real checkbox (or radio) underneath, so keyboard and
 * screen readers behave natively.
 */
export function ChoiceRow({
  type = "checkbox",
  name,
  checked,
  onChange,
  icon,
  label,
  disabled,
  trailing,
}: {
  type?: "checkbox" | "radio";
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: ReactNode;
  label: ReactNode;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-15 items-center rounded-xl border transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brown",
        checked ? "border-brown bg-white shadow-[inset_0_0_0_1px_var(--color-brown)]" : "border-stone bg-white/70 hover:border-sand hover:bg-white",
      )}
    >
      <label className="flex min-h-15 min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-2.5">
        <input
          type={type}
          name={name}
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {icon ? (
          <span className={cn("shrink-0", checked ? "text-brown" : "text-muted")} aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className={cn("min-w-0 flex-1 text-[1.0625rem] leading-snug", checked ? "font-semibold text-espresso" : "text-espresso")}>
          {label}
        </span>
        <span
          aria-hidden
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center border-2 transition-colors",
            type === "radio" ? "rounded-full" : "rounded-md",
            checked ? "border-brown bg-brown text-cream" : "border-sand bg-white",
          )}
        >
          {checked ? type === "radio" ? <span className="size-2.5 rounded-full bg-cream" /> : <Check size={14} weight="bold" /> : null}
        </span>
      </label>
      {trailing}
    </div>
  );
}

/** One heading, one short explanation. The heading takes focus on each step change. */
export function StepHead({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="mb-8 sm:mb-10">
      <h1
        id="current-step-title"
        tabIndex={-1}
        className="max-w-[22ch] text-[1.75rem] font-bold leading-[1.2] tracking-[-0.01em] text-espresso focus:outline-none sm:text-[2.125rem] rtl:tracking-normal"
      >
        {title}
      </h1>
      <p className="mt-3 max-w-[52ch] text-[1.0625rem] leading-relaxed text-muted sm:text-lg">{lead}</p>
    </div>
  );
}
