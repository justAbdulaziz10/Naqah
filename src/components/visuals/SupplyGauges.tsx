"use client";

import { CERTAINTY_LABELS, RESOURCE_LABELS, levelLabel } from "@/domain/catalog";
import type { Level, Resource } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

/** One meter for every resource: stock fills to the amount ("about half" fills half); a condition fills to how sound it is. */
const fill: Record<Level, number> = { good: 1, medium: 0.5, low: 0.25, critical: 0.08, unknown: 0 };
const tone: Record<Level, { bar: string; text: string }> = {
  good: { bar: "bg-ok", text: "text-ok" },
  medium: { bar: "bg-espresso/70", text: "text-espresso" },
  low: { bar: "bg-warn", text: "text-warn" },
  critical: { bar: "bg-danger", text: "text-danger" },
  unknown: { bar: "", text: "text-muted" },
};
/** A fence or shelter "needs work" is a warning, where half a stock is still fine. */
const conditionTone: Record<Level, { bar: string; text: string }> = { ...tone, medium: { bar: "bg-warn", text: "text-warn" } };
const isCondition = (resource: Resource) => resource.kind === "fences" || resource.kind === "shelter";

/**
 * The supplies NAQAH asked about, one row each: the supply, its state in words, and the same quiet
 * track for every row, filled to the amount or to the condition, with the worker's rough quantity and
 * provenance beneath only where it is not the plain report. The words carry everything; the track repeats it.
 */
export function SupplyGauges({ resources, className }: { resources: Resource[]; columns?: 2 | 4; className?: string }) {
  const { t } = useI18n();
  const present = resources.filter((resource) => resource.present);
  if (!present.length) return null;
  return (
    <ul className={cn("divide-y divide-stone/60", className)}>
      {present.map((resource) => {
        const colours = isCondition(resource) ? conditionTone : tone;
        // A reported amount with no level ("25 كيس") is the answer itself, not «غير معروف».
        const amountOnly = resource.level === "unknown" && Boolean(resource.quantity);
        const level = amountOnly ? resource.quantity! : t(levelLabel(resource.kind, resource.level));
        const note = [amountOnly ? null : resource.quantity, resource.certainty !== "reported" ? t(CERTAINTY_LABELS[resource.certainty]) : null].filter(Boolean).join(" · ");
        return (
          <li key={resource.kind} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="font-semibold text-espresso">{t(RESOURCE_LABELS[resource.kind])}</span>
                <span className={cn("text-[0.9375rem] font-medium", amountOnly ? "text-espresso" : colours[resource.level].text)}>{level}</span>
              </p>
              {note ? <p className="mt-0.5 text-[0.8125rem] text-muted">{note}</p> : null}
            </div>
            <span aria-hidden className={cn("relative h-2 w-20 overflow-hidden rounded-full sm:w-28", resource.level === "unknown" ? "border border-dashed border-faint" : "bg-stone/60")}>
              {resource.level === "unknown" ? null : (
                <span className={cn("naqah-fill absolute inset-y-0 start-0 rounded-full", colours[resource.level].bar)} style={{ width: `${fill[resource.level] * 100}%` }} />
              )}
              {/* Quarter marks, so "about half" is read against the whole. */}
              {[0.25, 0.5, 0.75].map((at) => <span key={at} className="absolute inset-y-0 w-px bg-cream/80" style={{ insetInlineStart: `${at * 100}%` }} />)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
