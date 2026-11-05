"use client";

import { Card, CardBody, CardHeader } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** Settings → Connections → phone. Owned by the phone integration slice. */
export function PhoneCard() {
  const { m } = useI18n();
  return (
    <Card>
      <CardHeader title={m.integrations.phone.title} />
      <CardBody />
    </Card>
  );
}
