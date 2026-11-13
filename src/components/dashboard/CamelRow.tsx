"use client";

import { CaretRight, ClipboardText } from "@phosphor-icons/react";
import { healthMark } from "@/components/visuals/HerdMarks";
import type { Camel, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { CertaintyBadge, HealthBadge } from "./DashboardPrimitives";
import { camelNews, openTasksFor } from "./camelNews";

/**
 * One camel in the herd list. A camel that needs attention shows its note, when it was updated and any open task
 * that names it; the others show the latest thing a report said about them, so the list reads as news, not a roster.
 */
export function CamelRow({ ws, camel, now, highlighted, compact, onOpen }: {
  ws: Workspace;
  camel: Camel;
  now: Date;
  highlighted: boolean;
  /** Healthy camels sit two to a row on wide screens, with the news on one line. */
  compact: boolean;
  onOpen: () => void;
}) {
  const { m, t, fmt, locale } = useI18n();
  const h = m.app.herd;
  const attention = camel.health === "sick" || camel.health === "watch";
  const news = attention && camel.healthNote ? null : camelNews(ws, camel)[0] ?? null;
  const task = attention ? openTasksFor(ws, camel)[0] ?? null : null;
  const worker = ws.settings.worker.name.trim() || m.app.overview.unnamedWorker;
  const [open, close] = locale === "ar" ? ["«", "»"] : ["“", "”"];
  const details = [
    camel.sex === "female" ? h.female : h.male,
    camel.ageYears === null ? h.ageUnknown : h.ageYears(fmt.number(camel.ageYears)),
  ].join(" · ");

  return (
    <button
      type="button"
      data-hash-target={`camel-${camel.id}`}
      aria-haspopup="dialog"
      onClick={onOpen}
      className={cn(
        "group flex w-full items-start gap-4 px-5 text-start transition-colors duration-200 hover:bg-ivory/70 focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brown active:bg-ivory sm:px-7",
        compact ? "min-h-16 bg-cream py-4" : "py-5",
        highlighted && "bg-ivory",
      )}
    >
      <span aria-hidden className={cn("mt-2 size-3 shrink-0 rounded-full", healthMark[camel.health])} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className={cn("font-semibold leading-snug text-espresso", compact ? "text-base" : "text-lg")}>{camel.name}</span>
          {/* The health word stays on every row, so the group heading is never the only place it is said. */}
          <HealthBadge health={camel.health} />
        </span>
        {attention && camel.healthNote ? <span className="mt-1 block text-[1.0625rem] leading-relaxed text-espresso">{camel.healthNote}</span> : null}
        <span className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted">
          <span>{details}</span>
          {attention ? (
            <>
              <span aria-hidden>·</span>
              {camel.certainty !== "reported" ? <CertaintyBadge certainty={camel.certainty} /> : null}
              <span>{camel.updatedAt ? h.updated(fmt.relative(camel.updatedAt, now)) : h.neverUpdated}</span>
            </>
          ) : null}
        </span>
        {task ? (
          <span className="mt-3 flex items-start gap-2 border-s-2 border-sand ps-3 text-sm leading-relaxed text-espresso">
            <ClipboardText size={16} className="mt-0.5 shrink-0 text-brown" aria-hidden />
            <span><span className="font-semibold">{h.openTask}</span> · {task.instruction}</span>
          </span>
        ) : null}
        {news ? (
          <span className={cn("block text-sm leading-relaxed", compact ? "mt-1.5" : "mt-2.5")}>
            <span className="text-muted">
              {news.source === "words" ? h.workerSaid(worker) : h.lastNews} · <time dateTime={news.at}>{fmt.relative(news.at, now)}</time>
            </span>
            <span className={cn("block text-espresso", compact && "truncate")}>
              {open}<bdi>{typeof news.text === "string" ? news.text : t(news.text)}</bdi>{close}
            </span>
          </span>
        ) : !attention && !compact ? <span className="mt-1.5 block text-sm text-muted">{h.noNewsYet}</span> : null}
      </span>
      <CaretRight size={18} className="mt-1.5 shrink-0 text-faint transition-transform duration-200 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
    </button>
  );
}
