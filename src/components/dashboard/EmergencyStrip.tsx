"use client";

import { CaretDown } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { MessageWorkerLink } from "@/components/integrations/WhatsAppActions";
import { EMERGENCY_LABELS } from "@/domain";
import type { Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";

/**
 * Standing reference, not news: who calls whom in an emergency, one line, with the cases and the
 * worker's number one step away. Basic's weekly owner call sits beside it, also for reference.
 */
export function EmergencyStrip({ ws, worker, allowance }: { ws: Workspace; worker: string; allowance: ReactNode }) {
  const { m, t, href, locale } = useI18n();
  const o = m.app.overview;
  const phone = ws.settings.worker.phone.trim();
  const categories = ws.settings.emergencies.map((category) =>
    category.kind === "custom" ? category.label || o.unknown : t(EMERGENCY_LABELS[category.kind]),
  );
  return (
    <section aria-labelledby="emergency-strip" className="grid gap-x-10 gap-y-4 rounded-[var(--radius-card)] bg-sand-soft/45 px-5 py-4 sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      <details className="group min-w-0">
        <summary className="flex min-h-11 cursor-pointer list-none flex-col gap-x-6 gap-y-1 rounded-xl py-1 sm:flex-row sm:items-center [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 leading-relaxed">
            <span id="emergency-strip" className="font-semibold text-espresso">{o.emergency}</span>
            <span className="naqah-name ms-2 text-espresso">{o.emergencyCalls(worker)}</span>
          </span>
          <span className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-brown sm:min-h-0">
            {o.emergencyMore}
            <CaretDown size={14} className="transition-transform duration-200 group-open:rotate-180" aria-hidden />
          </span>
        </summary>
        <div className="pb-2 pt-1">
          {phone ? <p className="font-semibold text-espresso"><bdi dir="ltr" className="ltr-nums">{phone}</bdi></p> : null}
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {categories.length ? <>{o.emergencyCases} {categories.join(locale === "ar" ? "، " : ", ")}</> : o.noEmergencyCategories}
          </p>
          <div className="flex flex-wrap items-center gap-x-5">
            <MessageWorkerLink />
            <Link href={`${href("/app/settings")}#settings-emergencies`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">{o.setupEmergencies}</Link>
          </div>
        </div>
      </details>
      {allowance}
    </section>
  );
}
