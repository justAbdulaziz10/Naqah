"use client";

import { Card, CardBody, CardHeader } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** Settings → Connections → calendar. Owned by the calendar integration slice. */
export function CalendarCard() {
  const { m } = useI18n();
  return (
    <Card>
      <CardHeader title={m.integrations.calendar.title} />
      <CardBody />
    </Card>
  );
}
