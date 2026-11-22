"use client";

import { cn } from "@/lib/cn";

/**
 * A toggle whose hit target is the full 44px box; the visible track stays 28px tall. Put it at the
 * end of a row (`flex items-center justify-between`) and the row itself is tappable in practice.
 */
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
        // The button is the tap area (44px tall, 56px wide); the track inside is the visual.
        "inline-flex min-h-11 w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative block h-7 w-12 rounded-full border transition-[background-color,border-color] duration-[var(--duration-micro)] ease-[var(--ease-standard)]",
          checked ? "border-brown bg-brown" : "border-stone bg-sand-soft",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-5 rounded-full bg-cream shadow-[0_1px_2px_rgb(41_36_31/0.25)] transition-[inset-inline-start] duration-[var(--duration-micro)] ease-[var(--ease-standard)]",
            checked ? "start-[23px]" : "start-[3px]",
          )}
        />
      </span>
    </button>
  );
}
