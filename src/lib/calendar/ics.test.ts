import { describe, expect, it } from "vitest";
import { generateIcs, generateTaskIcs } from "./ics";
import type { CalendarSchedule } from "./schedule";

const NOW = new Date("2026-11-05T12:00:00.000Z");

describe("generateIcs", () => {
  it("writes a weekly Riyadh event, stable UID, 15-minute alarm, and CRLF lines", () => {
    const schedule: CalendarSchedule = {
      v: 1,
      l: "ar",
      f: "مزرعة النخيل",
      p: "basic",
      w: { day: 4, start: "17:00", end: "17:30" },
      t: [],
    };
    const result = generateIcs(schedule, NOW);

    expect(result).toContain("TZID:Asia/Riyadh");
    expect(result).toContain("DTSTART;TZID=Asia/Riyadh:20000106T170000");
    expect(result).toContain("DTEND;TZID=Asia/Riyadh:20000106T173000");
    expect(result).toContain("RRULE:FREQ=WEEKLY;BYDAY=TH");
    expect(result).toContain("UID:report-weekly@naqah.app");
    expect(result).toContain("TRIGGER:-PT15M");
    expect(result).toContain("SUMMARY:تحديث المزرعة");
    expect(result).toMatch(/\r\n$/);
    expect(result.replace(/\r\n/g, "")).not.toMatch(/(?<!\r)\n/);
  });

  it("writes the Ultimate daily slot and one-off UTC task events", () => {
    const schedule: CalendarSchedule = {
      v: 1,
      l: "en",
      f: "North Farm",
      p: "ultimate",
      w: null,
      t: [{ id: "task-1", title: "Check water", at: "2026-11-06T14:00:00.000Z" }],
    };
    const result = generateIcs(schedule, NOW);

    expect(result).toContain("DTSTART;TZID=Asia/Riyadh:20000102T170000");
    expect(result).toContain("RRULE:FREQ=DAILY");
    expect(result).toContain("UID:report-daily@naqah.app");
    expect(result).toContain("UID:task-1@naqah.app");
    expect(result).toContain("DTSTART:20261106T140000Z");
    expect(result).toContain("DTEND:20261106T143000Z");
    expect(result).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT6H");
  });

  it("escapes calendar text and folds long Arabic lines within 75 UTF-8 octets", () => {
    const title = "مراجعة العلف، الماء; والمخزون ".repeat(5) + "\\خطة\nاليوم";
    const schedule: CalendarSchedule = {
      v: 1,
      l: "en",
      f: "Camel Farm",
      p: "ultimate",
      w: null,
      t: [{ id: "arabic-task", title, at: "2026-11-06T14:00:00.000Z" }],
    };
    const result = generateIcs(schedule, NOW);
    const physicalLines = result.split("\r\n").filter(Boolean);
    const unfolded = result.replace(/\r\n[ ]/g, "");

    expect(unfolded).toContain("SUMMARY:" + title.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"));
    expect(physicalLines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(physicalLines.some((line) => line.startsWith(" "))).toBe(true);
  });

  it("keeps the recurring DTSTART stable when the feed is refreshed", () => {
    const schedule: CalendarSchedule = {
      v: 1,
      l: "en",
      f: "Farm",
      p: "basic",
      w: { day: 4, start: "10:00", end: "11:00" },
      t: [],
    };

    const first = generateIcs(schedule, NOW);
    const later = generateIcs(schedule, new Date("2026-11-12T12:00:00.000Z"));
    expect(first).toContain("DTSTART;TZID=Asia/Riyadh:20000106T100000");
    expect(later).toContain("DTSTART;TZID=Asia/Riyadh:20000106T100000");
  });

  it("keeps a standalone task file free of the recurring report event", () => {
    const schedule: CalendarSchedule = {
      v: 1,
      l: "en",
      f: "North Farm",
      p: "ultimate",
      w: null,
      t: [{ id: "task-1", title: "Check water", at: "2026-11-06T14:00:00.000Z" }],
    };

    const result = generateTaskIcs(schedule, NOW);
    expect(result).toContain("UID:task-1@naqah.app");
    expect(result).not.toContain("UID:report-daily@naqah.app");
    expect(result).not.toContain("RRULE:");
  });
});
