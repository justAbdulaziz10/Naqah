"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { SettingsDisclosure } from "@/components/setup/sections/SettingsDisclosure";
import { useI18n } from "@/i18n/client";
import { useWeatherRefresh } from "@/components/dashboard/useWeatherRefresh";
import { regionForCoords } from "@/lib/geo/regions";
import { savedForSure } from "@/store/account";
import { useWorkspace, useWorkspaceStore } from "@/store/workspace";

type LocationFeedback = "saved" | "unsupported" | "denied" | "timeout" | "unavailable";

/** Settings → Connections → weather. Owned by the weather integration slice. */
export function WeatherCard() {
  const { m, fmt } = useI18n();
  const weatherMessages = m.integrations.weather;
  const workspace = useWorkspace();
  const update = useWorkspaceStore((state) => state.update);
  const { refresh, refreshing } = useWeatherRefresh();
  const [locating, setLocating] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState<LocationFeedback | null>(null);

  if (!workspace) return null;

  const farm = workspace.settings.farm;
  const coords = farm.coords;
  const region = regionForCoords(coords);
  const locationName = region ? weatherMessages.regions[region.id] : farm.location.trim() || weatherMessages.farmFallback;

  function useDeviceLocation() {
    const geolocation = typeof navigator === "undefined" ? undefined : navigator.geolocation;
    if (typeof geolocation?.getCurrentPosition !== "function") {
      setLocationFeedback("unsupported");
      return;
    }

    setLocating(true);
    setLocationFeedback(null);
    geolocation.getCurrentPosition(
      (position) => {
        update((current) => ({
          ...current,
          settings: {
            ...current.settings,
            farm: {
              ...current.settings.farm,
              coords: { lat: position.coords.latitude, lon: position.coords.longitude },
            },
          },
        }));
        setLocating(false);
        void savedForSure().then((saved) => setLocationFeedback(saved ? "saved" : null));
      },
      (error) => {
        setLocating(false);
        setLocationFeedback(error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable");
      },
      { maximumAge: 0, timeout: 10_000 },
    );
  }

  const feedbackCopy = locationFeedback === "saved"
    ? weatherMessages.locationSaved
    : locationFeedback === "unsupported"
      ? weatherMessages.locationUnsupported
      : locationFeedback === "denied"
        ? weatherMessages.locationDenied
        : locationFeedback === "timeout"
          ? weatherMessages.locationTimeout
          : locationFeedback === "unavailable"
            ? weatherMessages.locationUnavailable
            : null;

  const weather = workspace.weather;
  const temperatures = weather ? (
    <>
      <bdi dir="ltr" className="ltr-nums">{fmt.number(Math.round(weather.maxTempC))}°</bdi> {weatherMessages.maximum}
      {weather.minTempC !== null ? (
        <> <span aria-hidden="true">·</span> <bdi dir="ltr" className="ltr-nums">{fmt.number(Math.round(weather.minTempC))}°</bdi> {weatherMessages.minimum}</>
      ) : null}
    </>
  ) : null;
  const summary = !coords
    ? weatherMessages.noLocationShort
    : temperatures ? <>{locationName} <span aria-hidden="true">·</span> {temperatures}</> : locationName;

  return (
    <SettingsDisclosure id="settings-weather" title={weatherMessages.title} summary={summary}>
      <div className="space-y-4">
        {!coords ? (
          <p className="text-sm leading-relaxed text-muted">{weatherMessages.noLocation}</p>
        ) : weather ? (
          <div>
            <p className="font-medium text-espresso">{weatherMessages.todayLabel(locationName)} {temperatures}</p>
            <p className="mt-0.5 text-sm text-muted">
              {weatherMessages.lastForecast} <time className="ltr-nums" dateTime={weather.fetchedAt}>{fmt.dateTime(weather.fetchedAt)}</time>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">{weatherMessages.forecastUnavailable}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant={coords ? "ghost" : "secondary"} className="min-h-11" disabled={locating} onClick={useDeviceLocation}>
            {locating ? weatherMessages.gettingLocation : weatherMessages.useMyLocation}
          </Button>
          {coords ? (
            <Button variant="secondary" className="min-h-11" disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? weatherMessages.refreshingForecast : weatherMessages.refreshForecast}
            </Button>
          ) : null}
        </div>

        {feedbackCopy ? (
          <p className="text-sm text-muted" role={locationFeedback === "saved" ? "status" : "alert"}>{feedbackCopy}</p>
        ) : null}
      </div>
    </SettingsDisclosure>
  );
}
