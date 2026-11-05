import type { FarmCoords } from "@/domain/types";

/** Approximate city-centre coordinates used as Saudi region weather presets. */
export const SAUDI_REGIONS = [
  { id: "riyadh", lat: 24.7136, lon: 46.6753 },
  { id: "alKharj", lat: 24.155, lon: 47.334 },
  { id: "qassim", lat: 26.357, lon: 43.977 },
  { id: "hail", lat: 27.5114, lon: 41.7208 },
  { id: "alAhsa", lat: 25.3647, lon: 49.5876 },
  { id: "tabuk", lat: 28.3838, lon: 36.5662 },
  { id: "jazan", lat: 16.8894, lon: 42.5511 },
  { id: "najran", lat: 17.4924, lon: 44.1277 },
  { id: "asir", lat: 18.2164, lon: 42.5053 },
  { id: "alJouf", lat: 29.9697, lon: 40.2064 },
  { id: "makkah", lat: 21.3891, lon: 39.8579 },
  { id: "madinah", lat: 24.5247, lon: 39.5692 },
  { id: "easternProvince", lat: 26.4207, lon: 50.0888 },
] as const;

export type SaudiRegionId = (typeof SAUDI_REGIONS)[number]["id"];
export type SaudiRegion = (typeof SAUDI_REGIONS)[number];

/** Match only exact preset points; device GPS can be anywhere in the region. */
export function regionForCoords(coords: FarmCoords | null | undefined): SaudiRegion | null {
  if (!coords) return null;
  return SAUDI_REGIONS.find((region) => region.lat === coords.lat && region.lon === coords.lon) ?? null;
}
