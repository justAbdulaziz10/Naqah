"use client";

import { Card, CardBody, CardHeader } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** Settings → Connections → pwa. Owned by the pwa integration slice. */
export function PwaCard() {
  const { m } = useI18n();
  return (
    <Card>
      <CardHeader title={m.integrations.pwa.title} />
      <CardBody />
    </Card>
  );
}
