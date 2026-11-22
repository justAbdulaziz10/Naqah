"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A checkbox or radio whose whole labelled row is the hit target (at least 44px tall). The native
 * input takes its accessible name from the wrapping label; `hint` is a quiet second line.
 */
export function ChoiceRow({
  label,
  hint,
  className,
  inputClassName,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  type: "checkbox" | "radio";
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60", className)}>
      <input {...input} className={cn("mt-1 size-5 shrink-0 accent-brown focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown", inputClassName)} />
      <span className="min-w-0">
        <span className="block text-espresso">{label}</span>
        {hint ? <span className="naqah-meta mt-0.5 block">{hint}</span> : null}
      </span>
    </label>
  );
}
