import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/calendar/route";
import { encodeSchedule, type CalendarSchedule } from "./schedule";

const schedule: CalendarSchedule = {
  v: 1,
  l: "ar",
  f: "مزرعة النخيل",
  p: "basic",
  w: { day: 4, start: "17:00", end: "17:30" },
  t: [],
};

describe("GET /api/calendar", () => {
  it("returns a valid calendar for a decoded snapshot", async () => {
    const response = await GET(
      new Request("https://naqah.example/api/calendar?s=" + encodeSchedule(schedule)),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="naqah.ics"');
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain("SUMMARY:تحديث المزرعة");
  });

  it("returns 400 for a malformed or missing snapshot", async () => {
    const malformed = await GET(new Request("https://naqah.example/api/calendar?s=bad!"));
    const missing = await GET(new Request("https://naqah.example/api/calendar"));

    expect(malformed.status).toBe(400);
    expect(missing.status).toBe(400);
  });
});
