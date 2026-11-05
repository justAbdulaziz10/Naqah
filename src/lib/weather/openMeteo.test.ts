import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTodayForecast, OPEN_METEO_TIMEOUT_MS } from "./openMeteo";

const coords = { lat: 24.155, lon: 47.334 };
const fetchedAt = new Date("2026-11-05T12:00:00.000Z");
const payload = {
  daily: {
    time: ["2026-11-05"],
    temperature_2m_max: [46],
    temperature_2m_min: [31],
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchTodayForecast", () => {
  it("requests the one-day Riyadh forecast and maps the daily values", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(payload) });

    await expect(fetchTodayForecast(coords, fetchedAt)).resolves.toEqual({
      fetchedAt: fetchedAt.toISOString(),
      date: "2026-11-05",
      maxTempC: 46,
      minTempC: 31,
      source: "open-meteo",
    });

    const [requestUrl, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("24.155");
    expect(url.searchParams.get("longitude")).toBe("47.334");
    expect(url.searchParams.get("daily")).toBe("temperature_2m_max,temperature_2m_min");
    expect(url.searchParams.get("timezone")).toBe("Asia/Riyadh");
    expect(url.searchParams.get("forecast_days")).toBe("1");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null for malformed JSON", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: vi.fn().mockRejectedValue(new Error("bad JSON")) });

    await expect(fetchTodayForecast(coords, fetchedAt)).resolves.toBeNull();
  });

  it("returns null for a non-200 response", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: vi.fn() });

    await expect(fetchTodayForecast(coords, fetchedAt)).resolves.toBeNull();
  });

  it("aborts a request after six seconds", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    const pending = fetchTodayForecast(coords, fetchedAt);
    await vi.advanceTimersByTimeAsync(OPEN_METEO_TIMEOUT_MS - 1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBeNull();
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });
});
