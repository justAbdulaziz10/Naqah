"use client";

import { Card, CardBody, CardHeader } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** Settings → Connections → whatsapp. Owned by the whatsapp integration slice. */
export function WhatsAppCard() {
  const { m } = useI18n();
  return (
    <Card>
      <CardHeader title={m.integrations.whatsapp.title} />
      <CardBody />
    </Card>
  );
}
