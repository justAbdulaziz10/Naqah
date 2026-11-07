"use client";

import { heatLevel, weatherForToday } from "@/domain/weather";
import { useI18n } from "@/i18n/client";
import { regionForCoords } from "@/lib/geo/regions";
import { useNow, useWorkspace } from "@/store/workspace";
import { useWeatherRefresh } from "./useWeatherRefresh";

export function WeatherLine({ className = "mt-2 text-sm text-muted" }: { className?: string }) {
  const { m } = useI18n();
  const workspace = useWorkspace();
  const now = useNow();
  useWeatherRefresh();

  if (!workspace?.settings.farm.coords) return null;
  const forecast = weatherForToday(workspace, now);
  if (!forecast) return null;

  const region = regionForCoords(workspace.settings.farm.coords);
  const location = region
    ? m.integrations.weather.regions[region.id]
    : workspace.settings.farm.location.trim() || m.integrations.weather.farmFallback;
  const heat = heatLevel(forecast.maxTempC);

  return (
    <p className={className}>
      {m.integrations.weather.todayLabel(location)}{" "}
      {m.integrations.weather.maximum} <bdi dir="ltr" className="ltr-nums">{Math.round(forecast.maxTempC)}°</bdi>
      {heat !== "none" ? <><span aria-hidden="true"> · </span>{m.integrations.weather.heatDay}</> : null}
    </p>
  );
}
