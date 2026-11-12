import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("phone numbers with the demo's UK option", () => {
  it("stays Saudi-only by default", async () => {
    const phone = await import("./phone");
    expect(phone.isSaudiMobile("+447700900123")).toBe(false);
    expect(phone.formatSaudiMobile("0501234567")).toBe("+966 50 123 4567");
  });

  it("accepts and formats a UK mobile when the local demo turns it on", async () => {
    vi.stubEnv("NEXT_PUBLIC_NAQAH_DEMO_UK_NUMBERS", "1");
    const phone = await import("./phone");
    for (const typed of ["+447700900123", "+44 7700 900123", "07700900123", "00447700900123"]) {
      expect(phone.isSaudiMobile(typed)).toBe(true);
      expect(phone.formatSaudiMobile(typed)).toBe("+44 7700 900123");
    }
    expect(phone.phoneCountry("+44 7700 900123")).toBe("GB");
    expect(phone.localSaudiPart("+44 7700 900123")).toBe("7700 900123");
    expect(phone.fromLocalSaudiPart("7700 900123", "GB")).toBe("+44 7700 900123");
    expect(phone.isSaudiMobile("+442079460000")).toBe(false);
    expect(phone.formatSaudiMobile("0501234567")).toBe("+966 50 123 4567");
  });
});
