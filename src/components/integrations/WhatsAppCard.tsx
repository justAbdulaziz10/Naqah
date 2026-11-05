"use client";

import { Card, CardBody, CardHeader, Field, Input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { toWaDigits } from "@/lib/whatsapp/links";
import { useWorkspace, useWorkspaceStore } from "@/store/workspace";
import { MessageWorkerLink } from "./WhatsAppActions";

/** Settings → Connections → whatsapp. Owned by the whatsapp integration slice. */
export function WhatsAppCard() {
  const { m } = useI18n();
  const ws = useWorkspace();
  if (!ws) return null;

  const supplierName = ws.settings.integrations?.supplierName ?? "";
  const supplierPhone = ws.settings.integrations?.supplierPhone ?? "";
  const invalidPhone = supplierPhone.length > 0 && toWaDigits(supplierPhone) === null;

  return (
    <Card>
      <CardHeader title={m.integrations.whatsapp.title} />
      <CardBody className="space-y-4 pt-3">
        <Field label={m.integrations.whatsapp.supplierName} hint={m.integrations.whatsapp.supplierNameHint}>
          {(id) => (
            <Input
              id={id}
              autoComplete="organization"
              value={supplierName}
              onChange={(event) => {
                const value = event.currentTarget.value;
                useWorkspaceStore.getState().update((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    integrations: { ...current.settings.integrations, supplierName: value },
                  },
                }));
              }}
            />
          )}
        </Field>
        <Field
          label={m.integrations.whatsapp.supplierPhone}
          hint={invalidPhone ? undefined : m.integrations.whatsapp.supplierPhoneHint}
          error={invalidPhone ? m.integrations.whatsapp.invalidSaudiMobile : undefined}
        >
          {(id) => (
            <Input
              id={id}
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              dir="ltr"
              className="ltr-nums"
              aria-invalid={invalidPhone}
              value={supplierPhone}
              onChange={(event) => {
                const value = event.currentTarget.value;
                useWorkspaceStore.getState().update((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    integrations: { ...current.settings.integrations, supplierPhone: value },
                  },
                }));
              }}
            />
          )}
        </Field>
        <div className="border-t border-stone/70 pt-2">
          <MessageWorkerLink />
        </div>
      </CardBody>
    </Card>
  );
}
