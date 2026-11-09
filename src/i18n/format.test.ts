import { describe, expect, it } from "vitest";
import { formatDateTime, formatRelative, formatTime } from "./format";

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

describe("relative dates count Riyadh calendar days", () => {
  const at = (iso: string) => new Date(iso);
  const said = (target: string, now: string, locale: "ar" | "en" = "en") => formatRelative(target, at(now), locale);

  it("keeps hours within the same day", () => {
    expect(said("2026-11-09T17:00:00+03:00", "2026-11-09T01:33:00+03:00")).toBe("in 15 hours");
    expect(said("2026-11-09T01:33:00+03:00", "2026-11-09T17:00:00+03:00")).toBe("15 hours ago");
  });

  it("says tomorrow for the next date, in both languages", () => {
    expect(said("2026-11-10T17:00:00+03:00", "2026-11-09T01:33:00+03:00")).toBe("tomorrow");
    expect(said("2026-11-10T17:00:00+03:00", "2026-11-09T01:33:00+03:00", "ar")).toBe("غدًا");
  });

  it("is right on either side of midnight", () => {
    expect(said("2026-11-10T23:59:00+03:00", "2026-11-09T00:01:00+03:00")).toBe("tomorrow");
    expect(said("2026-11-11T00:01:00+03:00", "2026-11-09T23:59:00+03:00")).toBe("in 2 days");
    expect(said("2026-11-09T00:30:00+03:00", "2026-11-10T23:00:00+03:00")).toBe("yesterday");
    expect(said("2026-11-08T19:00:00+03:00", "2026-11-10T01:00:00+03:00")).toBe("2 days ago");
  });

  it("uses the Riyadh date, not the UTC date", () => {
    // 00:30 on the 10th in Riyadh is still the 9th in UTC.
    expect(formatRelative("2026-11-11T20:30:00Z", at("2026-11-09T21:30:00Z"), "en")).toBe("tomorrow");
  });

  it("crosses month and year boundaries", () => {
    expect(said("2026-11-01T17:00:00+03:00", "2026-10-31T01:33:00+03:00")).toBe("tomorrow");
    expect(said("2026-12-01T17:00:00+03:00", "2026-11-30T01:33:00+03:00")).toBe("tomorrow");
    expect(said("2027-01-01T17:00:00+03:00", "2026-12-31T01:33:00+03:00")).toBe("tomorrow");
    expect(said("2027-03-01T17:00:00+03:00", "2027-02-28T01:33:00+03:00")).toBe("tomorrow");
    expect(said("2028-03-01T17:00:00+03:00", "2028-02-28T01:33:00+03:00")).toBe("in 2 days");
  });

  it("leaves a call less than a day away in hours, even across midnight", () => {
    expect(said("2026-11-10T17:00:00+03:00", "2026-11-09T23:30:00+03:00")).toBe("in 18 hours");
  });
});
