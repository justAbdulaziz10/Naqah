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
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full overflow-x-auto rounded-full border border-stone bg-ivory p-1 [scrollbar-width:none]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-11 shrink-0 whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brown sm:px-4",
            value === o.value ? "bg-espresso/[0.08] text-espresso" : "text-muted hover:bg-espresso/[0.04] hover:text-espresso",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
