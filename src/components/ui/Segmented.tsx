"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A quiet filter control. The chosen option is raised on cream with a hairline and a heavier
 * weight, so the state reads without colour. Items hug their content at a fixed 44px height; the
 * group scrolls sideways on narrow screens instead of wrapping or stretching. Callers should not
 * stretch items (no `flex-1`): one control, one shape, on every page.
 */
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
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "naqah-press inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-4 text-sm leading-none transition-[background-color,color,border-color] duration-[var(--duration-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brown",
              active ? "border-stone bg-cream font-semibold text-espresso" : "border-transparent font-medium text-muted hover:text-espresso",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
