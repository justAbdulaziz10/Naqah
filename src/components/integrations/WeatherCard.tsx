"use client";

import { useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@/components/ui";
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

  return (
    <Card>
      <CardHeader title={weatherMessages.title} />
      <CardBody className="space-y-4">
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-semibold text-espresso">{weatherMessages.locationLabel}: </span>
            <span>{locationName}</span>
          </p>
          <p className="text-muted">
            <span className="font-semibold text-espresso">{weatherMessages.locationStatus}: </span>
            {coords ? (
              <>
                {weatherMessages.coordinatesSet} <bdi className="ltr-nums">({coords.lat.toFixed(3)}, {coords.lon.toFixed(3)})</bdi>
              </>
            ) : weatherMessages.coordinatesNotSet}
          </p>
        </div>

        <div className="space-y-1.5">
          {workspace.weather ? (
            <>
              <p className="text-sm font-semibold text-espresso">{weatherMessages.forecast}</p>
              <p className="font-medium text-espresso">
                <bdi dir="ltr" className="ltr-nums">{fmt.number(Math.round(workspace.weather.maxTempC))}°</bdi> {weatherMessages.maximum}
                {workspace.weather.minTempC !== null ? (
                  <> <span aria-hidden="true">·</span> <bdi dir="ltr" className="ltr-nums">{fmt.number(Math.round(workspace.weather.minTempC))}°</bdi> {weatherMessages.minimum}</>
                ) : null}
              </p>
              <p className="text-sm text-muted">
                {weatherMessages.lastForecast}: <time className="ltr-nums" dateTime={workspace.weather.fetchedAt}>{fmt.dateTime(workspace.weather.fetchedAt)}</time>
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">{weatherMessages.forecastUnavailable}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-11" disabled={locating} onClick={useDeviceLocation}>
            {locating ? weatherMessages.gettingLocation : weatherMessages.useMyLocation}
          </Button>
          <Button variant="secondary" className="min-h-11" disabled={!coords || refreshing} onClick={() => void refresh()}>
            {refreshing ? weatherMessages.refreshingForecast : weatherMessages.refreshForecast}
          </Button>
        </div>

        {feedbackCopy ? (
          <p className="text-sm text-muted" role={locationFeedback === "saved" ? "status" : "alert"}>{feedbackCopy}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
