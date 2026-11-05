"use client";

import { Card, CardBody, CardHeader } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** Settings → Connections → weather. Owned by the weather integration slice. */
export function WeatherCard() {
  const { m } = useI18n();
  return (
    <Card>
      <CardHeader title={m.integrations.weather.title} />
      <CardBody />
    </Card>
  );
}
