"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-full border border-stone bg-ivory p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-11 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown",
            value === o.value ? "bg-cream text-espresso shadow-soft" : "text-muted hover:text-espresso",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
