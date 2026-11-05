import { describe, expect, it } from "vitest";
import { regionForCoords, SAUDI_REGIONS } from "./regions";

describe("Saudi weather location presets", () => {
  it("includes all requested regions and the Al-Kharj demo coordinates", () => {
    expect(SAUDI_REGIONS.map((region) => region.id)).toEqual([
      "riyadh",
      "alKharj",
      "qassim",
      "hail",
      "alAhsa",
      "tabuk",
      "jazan",
      "najran",
      "asir",
      "alJouf",
      "makkah",
      "madinah",
      "easternProvince",
    ]);
    expect(regionForCoords({ lat: 24.155, lon: 47.334 })?.id).toBe("alKharj");
  });

  it("does not label unlisted, missing, or nearby GPS points as a preset", () => {
    expect(regionForCoords({ lat: 24.1551, lon: 47.334 })).toBeNull();
    expect(regionForCoords(undefined)).toBeNull();
    expect(regionForCoords(null)).toBeNull();
  });
});
