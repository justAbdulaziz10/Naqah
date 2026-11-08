"use client";

import { SettingsDisclosure } from "@/components/setup/sections/SettingsDisclosure";
import { PhoneField, StepField, StepInput } from "@/components/setup/onboarding/WizardParts";
import { useI18n } from "@/i18n/client";
import { useWorkspace, useWorkspaceStore } from "@/store/workspace";
import { MessageWorkerLink } from "./WhatsAppActions";

type SupplierField = "supplierName" | "supplierPhone";

function setSupplier(field: SupplierField, value: string) {
  useWorkspaceStore.getState().update((current) => ({
    ...current,
    settings: {
      ...current.settings,
      integrations: { ...current.settings.integrations, [field]: value },
    },
  }));
}

/** Settings → Connections → whatsapp. Owned by the whatsapp integration slice. */
export function WhatsAppCard() {
  const { m } = useI18n();
  const ws = useWorkspace();
  if (!ws) return null;

  const copy = m.integrations.whatsapp;
  const supplierName = ws.settings.integrations?.supplierName ?? "";
  const supplierPhone = ws.settings.integrations?.supplierPhone ?? "";

  return (
    <SettingsDisclosure id="settings-whatsapp" title={copy.title} summary={supplierName.trim() || copy.summary}>
      <p className="text-sm leading-relaxed text-muted">{copy.lead}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <StepField label={copy.supplierName}>
          {({ id }) => (
            <StepInput id={id} autoComplete="organization" value={supplierName} onChange={(event) => setSupplier("supplierName", event.currentTarget.value)} />
          )}
        </StepField>
        <PhoneField label={copy.supplierPhone} value={supplierPhone} onChange={(value) => setSupplier("supplierPhone", value)} autoComplete="off" />
      </div>
      <div className="mt-3 empty:hidden">
        <MessageWorkerLink />
      </div>
    </SettingsDisclosure>
  );
}
