"use client";

import { useState } from "react";
import { Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { regionForCoords, SAUDI_REGIONS } from "@/lib/geo/regions";
import { useSaveStatus } from "@/store/workspace";
import { SaveState } from "../SaveState";
import { PhoneInput } from "./PhoneInput";
import type { SetupSectionProps } from "../types";

type LocationFeedback = "saved" | "unsupported" | "denied" | "timeout" | "unavailable";

export function OwnerFarmSection({ ws, onChange, showSaved, showLocation = true }: SetupSectionProps & { showLocation?: boolean }) {
  const { m } = useI18n();
  const { owner, farm } = ws.settings;
  const weather = m.integrations.weather;
  const [locating, setLocating] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState<LocationFeedback | null>(null);
  const currentRegion = regionForCoords(farm.coords);

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
        onChange((current) => ({
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
        // The section's save state already reports a failed write; only confirm one that landed.
        setLocationFeedback(useSaveStatus.getState().status === "failed" ? null : "saved");
      },
      (error) => {
        setLocating(false);
        setLocationFeedback(error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable");
      },
      { maximumAge: 0, timeout: 10_000 },
    );
  }

  const feedbackCopy = locationFeedback === "saved"
    ? weather.locationSaved
    : locationFeedback === "unsupported"
      ? weather.locationUnsupported
      : locationFeedback === "denied"
        ? weather.locationDenied
        : locationFeedback === "timeout"
          ? weather.locationTimeout
          : locationFeedback === "unavailable"
            ? weather.locationUnavailable
            : null;

  return (
    <Card>
      <CardHeader
        title={m.onboarding.sectionTitles.ownerFarm}
        action={showSaved ? <SaveState /> : undefined}
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label={m.onboarding.ownerName} hint={m.onboarding.optional}>
          {(id) => (
            <Input
              id={id}
              autoComplete="name"
              value={owner.name}
              onChange={(event) => onChange((current) => ({
                ...current,
                settings: { ...current.settings, owner: { ...current.settings.owner, name: event.target.value } },
              }))}
            />
          )}
        </Field>
        <PhoneInput
          label={m.onboarding.ownerPhone}
          value={owner.phone}
          onChange={(phone) => onChange((current) => ({
            ...current,
            settings: { ...current.settings, owner: { ...current.settings.owner, phone } },
          }))}
        />
        <Field label={m.onboarding.farmName} hint={m.onboarding.optional}>
          {(id) => (
            <Input
              id={id}
              value={farm.name}
              onChange={(event) => onChange((current) => ({
                ...current,
                settings: { ...current.settings, farm: { ...current.settings.farm, name: event.target.value } },
              }))}
            />
          )}
        </Field>
        {showLocation ? (
          <>
            <Field label={m.onboarding.location} hint={m.onboarding.optional}>
              {(id) => (
                <Input
                  id={id}
                  autoComplete="address-level2"
                  value={farm.location}
                  onChange={(event) => onChange((current) => ({
                    ...current,
                    settings: { ...current.settings, farm: { ...current.settings.farm, location: event.target.value } },
                  }))}
                />
              )}
            </Field>
            <Field label={weather.regionLabel}>
              {(id) => (
                <Select
                  id={id}
                  value={currentRegion?.id ?? ""}
                  onChange={(event) => {
                    const region = SAUDI_REGIONS.find((item) => item.id === event.target.value);
                    if (!region) return;
                    const location = weather.regions[region.id];
                    onChange((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        farm: {
                          ...current.settings.farm,
                          location,
                          coords: { lat: region.lat, lon: region.lon },
                        },
                      },
                    }));
                    setLocationFeedback(null);
                  }}
                >
                  <option value="" disabled>{weather.chooseRegion}</option>
                  {SAUDI_REGIONS.map((region) => (
                    <option key={region.id} value={region.id}>{weather.regions[region.id]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex flex-col items-start justify-end gap-2">
              <Button variant="secondary" className="min-h-11" disabled={locating} onClick={useDeviceLocation}>
                {locating ? weather.gettingLocation : weather.useMyLocation}
              </Button>
              <p className="text-sm text-muted">
                {farm.coords ? (
                  <bdi className="ltr-nums">{farm.coords.lat.toFixed(3)}, {farm.coords.lon.toFixed(3)}</bdi>
                ) : weather.coordinatesNotSet}
              </p>
            </div>
            {feedbackCopy ? (
              <p className="sm:col-span-2 text-sm text-muted" role={locationFeedback === "saved" ? "status" : "alert"}>
                {feedbackCopy}
              </p>
            ) : null}
          </>
        ) : (
          <p className="sm:col-span-2 text-sm text-muted">{m.onboarding.locationSetLater}</p>
        )}
      </CardBody>
    </Card>
  );
}
