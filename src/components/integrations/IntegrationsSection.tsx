"use client";

import { useI18n } from "@/i18n/client";
import { CalendarCard } from "./CalendarCard";
import { PhoneCard } from "./PhoneCard";
import { PwaCard } from "./PwaCard";
import { WeatherCard } from "./WeatherCard";
import { WhatsAppCard } from "./WhatsAppCard";

/** Settings → Connections. Each card is owned by one integration; see docs/integrations/. */
export function IntegrationsSection() {
  const { m } = useI18n();
  return (
    <section id="connections" aria-labelledby="connections-title" className="scroll-mt-24 space-y-5 pt-4">
      <h2 id="connections-title" className="text-xl font-semibold tracking-tight">{m.integrations.section.title}</h2>
      <PhoneCard />
      <PwaCard />
      <CalendarCard />
      <WhatsAppCard />
      <WeatherCard />
    </section>
  );
}
