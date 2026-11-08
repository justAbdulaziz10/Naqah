"use client";

import { ArrowRight, CaretRight } from "@phosphor-icons/react";
import Link from "next/link";
import { HERD_DOTS_MAX, HerdDots } from "@/components/visuals/HerdDots";
import { HerdHealthBar } from "@/components/visuals/HerdHealthBar";
import { ButtonLink } from "@/components/ui";
import type { Camel, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { HealthBadge } from "./DashboardPrimitives";
import { HerdCountFact } from "./HerdCountFact";

const concern: Record<Camel["health"], number> = { sick: 0, watch: 1, unknown: 2, healthy: 3 };

/**
 * The whole herd as a field of marks, one per camel of the owner's count: the named ones in their
 * health, the rest as quiet outlines, so 42 camels never sit over a bar of 8. The camels that need
 * attention are called out by name beneath it, each opening its record.
 */
export function HerdField({ ws, worker }: { ws: Workspace; worker: string }) {
  const { m, href } = useI18n();
  const h = m.app.herd;
  const following = ws.camels.filter((camel) => camel.health === "sick" || camel.health === "watch").sort((a, b) => concern[a.health] - concern[b.health]);
  const dots = Math.max(ws.settings.herdCount ?? 0, ws.camels.length) <= HERD_DOTS_MAX;
  const reported = ws.camels.some((camel) => camel.health !== "unknown");

  return (
    <section aria-labelledby="herd-field" className="naqah-rise rounded-[var(--radius-card)] border border-stone/70 bg-cream px-5 py-6 sm:px-7">
      <div className="flex items-start justify-between gap-3">
        <h2 id="herd-field" className="text-2xl font-semibold leading-tight tracking-[-0.01em] text-espresso">{h.title}</h2>
        {ws.camels.length ? (
          <Link href={href("/app/herd")} className="naqah-nudge -me-2 -mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-brown hover:bg-espresso/5">
            {m.app.overview.viewHerd}
            <ArrowRight size={15} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
          </Link>
        ) : null}
      </div>
      <HerdCountFact ws={ws} worker={worker} className="mt-3" />
      {dots ? <HerdDots camels={ws.camels} herdCount={ws.settings.herdCount} className="mt-5" /> : <HerdHealthBar camels={ws.camels} className="mt-5" />}

      {following.length ? (
        <ul className="mt-5 divide-y divide-stone/70 border-t border-stone/70">
          {following.map((camel) => (
            <li key={camel.id}>
              <Link
                href={`${href("/app/herd")}#camel-${camel.id}`}
                className="group -mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-200 hover:bg-ivory active:bg-ivory/80"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="naqah-name text-lg font-semibold text-espresso">{camel.name}</span>
                    <HealthBadge health={camel.health} />
                  </span>
                  {camel.healthNote ? <span className="naqah-name mt-0.5 block text-sm leading-relaxed text-muted">{camel.healthNote}</span> : null}
                </span>
                <CaretRight size={16} className="shrink-0 text-faint transition-transform duration-200 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : ws.camels.length ? (
        <p className="mt-5 border-t border-stone/70 pt-4 text-sm text-muted">{reported ? h.noneFollowed : h.noneReported}</p>
      ) : (
        <ButtonLink href={href("/app/herd")} variant="secondary" className="mt-5">{m.app.overview.addCamels}</ButtonLink>
      )}
    </section>
  );
}
