"use client";

import { WarningCircle } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/cn";

/** Shared input surface: 12px radius, hairline border, brown focus ring, honest disabled state. */
const control =
  "w-full rounded-[var(--radius-control)] border border-stone bg-cream px-4 text-[0.95rem] text-espresso placeholder:text-faint transition-[border-color,box-shadow] duration-[var(--duration-micro)] focus:border-brown focus:outline-none focus:ring-2 focus:ring-brown/25 focus:ring-offset-0 aria-invalid:border-danger aria-invalid:focus:ring-danger/25 disabled:cursor-not-allowed disabled:border-stone/70 disabled:bg-ivory disabled:text-muted";

/**
 * Label above, help below in muted, error in danger with an icon and text. The child receives the
 * control id; pass `aria-invalid` and `aria-describedby` to the control through `describe` when
 * screen readers should hear the help or error.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Receives the control id; the second argument holds aria attributes for the control. */
  children: (id: string, describe: { "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
  className?: string;
  /** Short word shown after the label, like "optional". */
  optional?: ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const describe = {
    "aria-describedby": error || hint ? noteId : undefined,
    ...(error ? { "aria-invalid": true as const } : {}),
  };
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-espresso">
        {label}
        {optional ? <span className="ms-1.5 font-normal text-muted">{optional}</span> : null}
      </label>
      {children(id, describe)}
      {error ? (
        <p id={noteId} className="flex items-start gap-1.5 text-sm leading-snug text-danger" role="alert">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={noteId} className="text-sm leading-snug text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-12", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-3 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(control, "h-12 appearance-none pe-10")} {...props}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute end-4 top-1/2 size-3.5 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M3.5 6 8 10.5 12.5 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
