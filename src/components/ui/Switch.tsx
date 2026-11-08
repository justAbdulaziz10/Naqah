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
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 after:absolute after:inset-x-[-4px] after:inset-y-[-8px] after:content-[''] disabled:opacity-50",
        checked ? "bg-brown" : "bg-stone",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-1 size-5 rounded-full bg-cream shadow transition-[inset-inline-start] duration-200",
          checked ? "start-6" : "start-1",
        )}
      />
    </button>
  );
}
