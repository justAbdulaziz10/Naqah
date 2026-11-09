"use client";

import { ArrowRight } from "@phosphor-icons/react";
import Link from "next/link";
import { HERD_DOTS_MAX, HerdDots } from "@/components/visuals/HerdDots";
import { HerdHealthBar } from "@/components/visuals/HerdHealthBar";
import { ButtonLink } from "@/components/ui";
import type { Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { HerdCountFact } from "./HerdCountFact";

/**
 * The herd count and composition, with each named camel linking to its record.
 * Health details live in the attention section so the same concern is not repeated here.
 */
export function HerdField({ ws, worker }: { ws: Workspace; worker: string }) {
  const { m, href } = useI18n();
  const h = m.app.herd;
  const dots = Math.max(ws.settings.herdCount ?? 0, ws.camels.length) <= HERD_DOTS_MAX;

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

      {ws.camels.length ? (
        <ul className="mt-4 flex flex-wrap gap-x-1 border-t border-stone/70 pt-2">
          {ws.camels.map((camel) => (
            <li key={camel.id}>
              <Link
                href={`${href("/app/herd")}#camel-${camel.id}`}
                className="naqah-name inline-flex min-h-11 items-center rounded-sm px-2 py-2 text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown"
              >
                {camel.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ButtonLink href={href("/app/herd")} variant="secondary" className="mt-5">{m.app.overview.addCamels}</ButtonLink>
      )}
    </section>
  );
}
