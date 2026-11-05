import type { ReactNode } from "react";

/** A status label: coloured text with an optional dot. Deliberately not a pill. */
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "gold" | "dark";

const tones: Record<Tone, string> = {
  neutral: "text-muted",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  gold: "text-brown",
  dark: "text-espresso",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold leading-tight", tones[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}
