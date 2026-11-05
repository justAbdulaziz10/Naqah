import { describe, expect, it } from "vitest";
import { fromRiyadh } from "./clock";
import { createEmptyWorkspace } from "./seed";
import { heatLevel, heatWaterFinding, weatherForToday, withDemoHeat } from "./weather";

describe("weather rules", () => {
  it("classifies heat thresholds", () => {
    expect(heatLevel(39.9)).toBe("none");
    expect(heatLevel(40)).toBe("hot");
    expect(heatLevel(44.9)).toBe("hot");
    expect(heatLevel(45)).toBe("extreme");
    expect(heatLevel(Number.NaN)).toBe("none");
  });

  it("returns only a forecast for today's Riyadh date", () => {
    const now = fromRiyadh(2026, 11, 5, 17, 10);
    const ws = withDemoHeat(createEmptyWorkspace(), now);

    expect(weatherForToday(ws, now)).toEqual(ws.weather);
    expect(weatherForToday(ws, fromRiyadh(2026, 11, 6, 0, 1))).toBeNull();
  });

  it("creates a demo forecast and an independently supplied warning finding", () => {
    const now = fromRiyadh(2026, 11, 5, 17, 10);
    const ws = createEmptyWorkspace();
    const heated = withDemoHeat(ws, now);

    expect(ws.weather).toBeUndefined();
    expect(heated.weather).toMatchObject({ date: "2026-11-05", maxTempC: 46, source: "open-meteo" });
    expect(heatWaterFinding("finding-1")).toEqual({
      id: "finding-1",
      criterionId: "weather_heat_day",
      text: {
        en: "The worker reported that water or shade may not be enough for a hot day",
        ar: "أفاد العامل أن الماء أو الظل قد ما يكفي في يوم حار",
      },
    });
  });
});
