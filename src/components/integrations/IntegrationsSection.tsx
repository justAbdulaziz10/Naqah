"use client";

import { Card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { CalendarCard } from "./CalendarCard";
import { PhoneCard } from "./PhoneCard";
import { PwaCard } from "./PwaCard";
import { WeatherCard } from "./WeatherCard";
import { WhatsAppCard } from "./WhatsAppCard";

/** Settings → Connections: one surface, one row per integration; see docs/integrations/. */
export function IntegrationsSection() {
  const { m } = useI18n();
  return (
    <section id="connections" aria-labelledby="connections-title" className="scroll-mt-[var(--settings-offset,9rem)] space-y-3">
      <h2 id="connections-title" className="text-lg font-semibold text-espresso">{m.integrations.section.title}</h2>
      <Card className="divide-y divide-stone/70 overflow-hidden">
        <PhoneCard />
        <PwaCard />
        <CalendarCard />
        <WhatsAppCard />
        <WeatherCard />
      </Card>
    </section>
  );
}
