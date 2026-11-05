"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FarmCoords, WeatherSnapshot } from "@/domain/types";
import { fetchTodayForecast } from "@/lib/weather/openMeteo";
import { useNow, useWorkspace, useWorkspaceStore } from "@/store/workspace";

const THREE_HOURS_MS = 3 * 60 * 60 * 1_000;
const requests = new Map<string, Promise<WeatherSnapshot | null>>();
const lastAttemptAt = new Map<string, number>();

function coordsKey(coords: FarmCoords) {
  return `${coords.lat},${coords.lon}`;
}

function sharedForecast(coords: FarmCoords, now: Date) {
  const key = coordsKey(coords);
  const inFlight = requests.get(key);
  if (inFlight) return inFlight;
  const request = fetchTodayForecast(coords, now).finally(() => requests.delete(key));
  requests.set(key, request);
  return request;
}

/** Fetch on entry and again when the workspace clock reaches the three-hour mark. */
export function useWeatherRefresh() {
  const workspace = useWorkspace();
  const update = useWorkspaceStore((state) => state.update);
  const now = useNow();
  const [refreshing, setRefreshing] = useState(false);
  const previousCoordsKey = useRef<string | null>(null);
  const coords = workspace?.settings.farm.coords;
  const latitude = coords?.lat;
  const longitude = coords?.lon;

  const refreshForecast = useCallback(async (force = false) => {
    const current = useWorkspaceStore.getState().workspace;
    const currentCoords = current?.settings.farm.coords;
    if (!current || !currentCoords) return;

    const key = coordsKey(currentCoords);
    const recentAttempt = lastAttemptAt.get(key);
    const fetchedAt = current.weather?.fetchedAt ? Date.parse(current.weather.fetchedAt) : Number.NaN;
    if (
      !force &&
      ((recentAttempt !== undefined && now.getTime() - recentAttempt < THREE_HOURS_MS) ||
        (Number.isFinite(fetchedAt) && now.getTime() - fetchedAt < THREE_HOURS_MS))
    ) {
      return;
    }

    lastAttemptAt.set(key, now.getTime());
    setRefreshing(true);
    try {
      const snapshot = await sharedForecast(currentCoords, now);
      if (!snapshot) return;
      update((latest) => {
        const latestCoords = latest.settings.farm.coords;
        if (!latestCoords || coordsKey(latestCoords) !== key) return latest;
        return { ...latest, weather: snapshot };
      });
    } catch {
      // A failed request leaves the previous forecast in place and never blocks the page.
    } finally {
      setRefreshing(false);
    }
  }, [now, update]);

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) {
      previousCoordsKey.current = null;
      return;
    }
    const key = `${latitude},${longitude}`;
    const locationChanged = previousCoordsKey.current !== null && previousCoordsKey.current !== key;
    previousCoordsKey.current = key;
    void refreshForecast(locationChanged);
  }, [latitude, longitude, refreshForecast]);

  const refresh = useCallback(() => refreshForecast(true), [refreshForecast]);
  return { refresh, refreshing };
}
