import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime } from "./format";

const morning = "2026-11-05T06:05:00+03:00";
const evening = "2026-11-05T17:40:00+03:00";

describe("clock format", () => {
  it("shows 12-hour Riyadh time with AM/PM in English", () => {
    expect(formatTime(morning, "en")).toBe("6:05 AM");
    expect(formatTime(evening, "en")).toBe("5:40 PM");
  });

  it("shows Latin digits, then ص/م, in Arabic", () => {
    expect(formatTime(morning, "ar")).toBe("6:05 ص");
    expect(formatTime(evening, "ar")).toBe("5:40 م");
  });

  it("uses the same clock inside a date and time", () => {
    expect(formatDateTime(evening, "en")).toContain("5:40 PM");
    expect(formatDateTime(evening, "ar")).toContain("5:40 م");
  });

  it("leaves dates without a time alone", () => {
    const dateOnly = { hour: undefined, minute: undefined } as const;
    expect(formatDateTime(evening, "en", dateOnly)).not.toMatch(/AM|PM/i);
  });
});
