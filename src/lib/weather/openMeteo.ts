import type { FarmCoords, WeatherSnapshot } from "@/domain/types";

export const OPEN_METEO_TIMEOUT_MS = 6_000;

interface OpenMeteoDaily {
  time?: unknown;
  temperature_2m_max?: unknown;
  temperature_2m_min?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function snapshotFrom(payload: unknown, fetchedAt: Date): WeatherSnapshot | null {
  if (!isRecord(payload) || !isRecord(payload.daily)) return null;
  const daily = payload.daily as OpenMeteoDaily;
  if (!Array.isArray(daily.time) || !Array.isArray(daily.temperature_2m_max)) return null;
  const date = daily.time[0];
  const maxTempC = daily.temperature_2m_max[0];
  if (!isDateKey(date) || typeof maxTempC !== "number" || !Number.isFinite(maxTempC)) return null;

  const minValue = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null;
  return {
    fetchedAt: fetchedAt.toISOString(),
    date,
    maxTempC,
    minTempC: typeof minValue === "number" && Number.isFinite(minValue) ? minValue : null,
    source: "open-meteo",
  };
}

/** Fetch one Riyadh-day forecast. Any network, timeout, or shape error returns null. */
export async function fetchTodayForecast(
  coords: FarmCoords,
  fetchedAt = new Date(),
): Promise<WeatherSnapshot | null> {
  if (
    typeof fetch !== "function" ||
    !Number.isFinite(coords.lat) ||
    !Number.isFinite(coords.lon) ||
    coords.lat < -90 || coords.lat > 90 ||
    coords.lon < -180 || coords.lon > 180
  ) {
    return null;
  }

  const query = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lon),
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "Asia/Riyadh",
    forecast_days: "1",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${query.toString()}`;
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const request = async (): Promise<WeatherSnapshot | null> => {
    const response = await fetch(url, controller ? { signal: controller.signal } : {});
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return snapshotFrom(payload, fetchedAt);
  };

  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      resolve(null);
    }, OPEN_METEO_TIMEOUT_MS);
  });

  try {
    return await Promise.race([request(), timeout]);
  } catch {
    return null;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
