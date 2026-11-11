"use client";

import { MagicWand } from "@phosphor-icons/react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

/**
 * LOCAL DEMO ONLY: a «تعبئة تجريبية» button that fills the current step with sample values, so a presenter can show a
 * flow without typing. It only fills fields; saving, validation and every next step stay the owner's own presses.
 * On only in builds with NEXT_PUBLIC_NAQAH_DEMO_AUTOFILL=1 (the local runner's --demo-autofill), never by default.
 */
export const DEMO_AUTOFILL = process.env.NEXT_PUBLIC_NAQAH_DEMO_AUTOFILL === "1";

export function DemoFillButton({ onFill, label, className }: { onFill: () => void; label?: string; className?: string }) {
  const { m } = useI18n();
  if (!DEMO_AUTOFILL) return null;
  return (
    <button
      type="button"
      onClick={onFill}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border border-dashed border-sand px-4 text-sm font-semibold text-brown transition-colors hover:bg-sand/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown",
        className,
      )}
    >
      <MagicWand size={18} aria-hidden />
      {label ?? m.common.demo.fill}
    </button>
  );
}
