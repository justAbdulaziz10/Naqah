"use client";

import { DEMO_AUTOFILL } from "@/components/demo/DemoFill";
import { CalendarCard } from "@/components/integrations/CalendarCard";
import { IntegrationsSection } from "@/components/integrations/IntegrationsSection";
import { PhoneCard } from "@/components/integrations/PhoneCard";
import { PwaCard } from "@/components/integrations/PwaCard";
import { WeatherCard } from "@/components/integrations/WeatherCard";
import { WhatsAppCard } from "@/components/integrations/WhatsAppCard";
import { MessageWorkerLink } from "@/components/integrations/WhatsAppActions";
import { PhoneField, StepField, StepInput } from "@/components/setup/onboarding/WizardParts";
import { SettingsDisclosure } from "@/components/setup/sections/SettingsDisclosure";
import { Card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { useWorkspace, useWorkspaceStore } from "@/store/workspace";
import { SettingsDemoDraft } from "./SettingsDemoDraft";
import { connectionsSample } from "./demo-samples";

export function SettingsConnections() {
  const { m } = useI18n();
  const ws = useWorkspace();
  if (!DEMO_AUTOFILL) return <IntegrationsSection />;
  if (!ws) return null;
  const copy = m.integrations.whatsapp;
  return (
    <SettingsDemoDraft ws={ws} onChange={(update) => useWorkspaceStore.getState().update(update)} sample={() => connectionsSample}>
      {(draft, controls, preview) => {
        const supplierName = draft.ws.settings.integrations?.supplierName ?? "";
        const supplierPhone = draft.ws.settings.integrations?.supplierPhone ?? "";
        const setSupplier = (field: "supplierName" | "supplierPhone", value: string) => draft.onChange((current) => ({
          ...current,
          settings: { ...current.settings, integrations: { ...current.settings.integrations, [field]: value } },
        }));
        return (
          <section id="connections" aria-labelledby="connections-title" className="scroll-mt-[var(--settings-offset,9rem)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="connections-title" className="text-lg font-semibold text-espresso">{m.integrations.section.title}</h2>
              {controls}
            </div>
            <Card className="divide-y divide-stone/70 overflow-hidden">
              <PhoneCard />
              <PwaCard />
              <CalendarCard />
              {preview ? <SettingsDisclosure id="settings-whatsapp" title={copy.title} summary={supplierName.trim() || copy.summary}>
                <p className="text-sm leading-relaxed text-muted">{copy.lead}</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <StepField label={copy.supplierName}>{({ id }) => <StepInput id={id} autoComplete="organization" value={supplierName} onChange={(event) => setSupplier("supplierName", event.currentTarget.value)} />}</StepField>
                  <PhoneField label={copy.supplierPhone} value={supplierPhone} onChange={(value) => setSupplier("supplierPhone", value)} autoComplete="off" />
                </div>
                <div className="mt-3 empty:hidden"><MessageWorkerLink /></div>
              </SettingsDisclosure> : <WhatsAppCard />}
              <WeatherCard />
            </Card>
          </section>
        );
      }}
    </SettingsDemoDraft>
  );
}
