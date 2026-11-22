"use client";

import { WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

/**
 * Full-screen loading: the camel mark breathing once or twice above one quiet line. Announced
 * through role=status; `label` defaults to a generic "Loading" and pages pass their own sentence.
 */
export function LoadingShell({ label, className, inline }: { label?: ReactNode; className?: string; inline?: boolean }) {
  const { m } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy
      className={cn("flex flex-col items-center justify-center gap-4 px-6 text-center", inline ? "py-16" : "min-h-dvh", className)}
    >
      <CamelMark className="h-10 w-auto text-brown opacity-80 motion-safe:animate-pulse" />
      <p className="naqah-meta">{label ?? m.common.states.loading}</p>
    </div>
  );
}

/**
 * Full-screen error: the plain cause and the way out. Announced through role=alert. Pass `retry`
 * (a Button) and/or `secondary` (a link home); never both as primary.
 */
export function ErrorShell({
  title,
  body,
  retry,
  secondary,
  className,
  inline,
}: {
  title?: ReactNode;
  body?: ReactNode;
  retry?: ReactNode;
  secondary?: ReactNode;
  className?: string;
  inline?: boolean;
}) {
  const { m } = useI18n();
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-5 px-6 text-center", inline ? "py-16" : "min-h-dvh", className)}>
      <WarningCircle size={32} weight="regular" className="text-danger" aria-hidden />
      <div className="max-w-md">
        <h1 className="naqah-heading text-xl">{title ?? m.common.states.errorTitle}</h1>
        <p className="naqah-meta mt-2">{body ?? m.common.states.errorBody}</p>
      </div>
      {retry || secondary ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {retry}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
