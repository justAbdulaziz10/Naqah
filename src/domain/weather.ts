import { dayKey } from "./clock";
import type { Finding, WeatherSnapshot, Workspace } from "./types";

export type HeatLevel = "none" | "hot" | "extreme";

/** Heat-day thresholds used by the worker report. */
export function heatLevel(maxTempC: number): HeatLevel {
  if (!Number.isFinite(maxTempC) || maxTempC < 40) return "none";
  return maxTempC < 45 ? "hot" : "extreme";
}

/** A stored forecast is useful to report rules only on its Riyadh calendar day. */
export function weatherForToday(ws: Workspace, now: Date): WeatherSnapshot | null {
  const snapshot = ws.weather;
  return snapshot?.date === dayKey(now) ? snapshot : null;
}

/** A deterministic hot forecast for the Call Lab demo clock. */
export function withDemoHeat(ws: Workspace, now: Date): Workspace {
  return {
    ...ws,
    weather: {
      fetchedAt: now.toISOString(),
      date: dayKey(now),
      maxTempC: 46,
      minTempC: 31,
      source: "open-meteo",
    },
  };
}

/** The worker reported that the farm needs more water or shade on a heat day. */
export function heatWaterFinding(id: string): Finding {
  return {
    id,
    criterionId: "weather_heat_day",
    text: {
      en: "The worker reported that water or shade may not be enough for a hot day",
      ar: "أفاد العامل أن الماء أو الظل قد ما يكفي في يوم حار",
    },
  };
}
