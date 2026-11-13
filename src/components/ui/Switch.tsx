"use client";

import { cn } from "@/lib/cn";

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // The ::after is the tap area: 44px tall while the visible track stays 28px.
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-[background-color,border-color] duration-[var(--duration-micro)] ease-[var(--ease-standard)] after:absolute after:inset-x-[-4px] after:inset-y-[-8px] after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-brown bg-brown" : "border-stone bg-sand-soft",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] size-5 rounded-full bg-cream shadow-[0_1px_2px_rgb(41_36_31/0.25)] transition-[inset-inline-start] duration-[var(--duration-micro)] ease-[var(--ease-standard)]",
          checked ? "start-[23px]" : "start-[3px]",
        )}
      />
    </button>
  );
}
