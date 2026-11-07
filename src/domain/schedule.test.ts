import { describe, expect, it } from "vitest";
import { fromRiyadh } from "./clock";
import { isCompleteCallSchedule, nextScheduledCall } from "./schedule";

// Thursday 5 Nov 2026, 17:10 Riyadh.
const THU_1710 = fromRiyadh(2026, 11, 5, 17, 10);

describe("report call schedule", () => {
  it("needs a day and a time on Basic, only a time on Ultimate", () => {
    expect(isCompleteCallSchedule("basic", { day: 4, time: "17:00" })).toBe(true);
    expect(isCompleteCallSchedule("basic", { day: null, time: "17:00" })).toBe(false);
    expect(isCompleteCallSchedule("basic", { day: 4, time: "" })).toBe(false);
    expect(isCompleteCallSchedule("ultimate", { day: null, time: "06:30" })).toBe(true);
    expect(isCompleteCallSchedule("ultimate", { day: null, time: "25:00" })).toBe(false);
    expect(isCompleteCallSchedule("ultimate", null)).toBe(false);
    expect(isCompleteCallSchedule("ultimate", undefined)).toBe(false);
  });

  it("has no next call while unfinished", () => {
    expect(nextScheduledCall(THU_1710, "basic", { day: null, time: "17:00" })).toBeNull();
    expect(nextScheduledCall(THU_1710, "ultimate", { day: null, time: "" })).toBeNull();
  });

  it("Basic: the same weekday later today, else next week", () => {
    expect(nextScheduledCall(THU_1710, "basic", { day: 4, time: "18:00" })).toEqual(fromRiyadh(2026, 11, 5, 18, 0));
    expect(nextScheduledCall(THU_1710, "basic", { day: 4, time: "17:10" })).toEqual(fromRiyadh(2026, 11, 12, 17, 10));
    expect(nextScheduledCall(THU_1710, "basic", { day: 4, time: "09:00" })).toEqual(fromRiyadh(2026, 11, 12, 9, 0));
  });

  it("Basic: the next chosen weekday, across the week boundary", () => {
    // Saturday 7 Nov, then Sunday 8 Nov.
    expect(nextScheduledCall(THU_1710, "basic", { day: 6, time: "08:00" })).toEqual(fromRiyadh(2026, 11, 7, 8, 0));
    expect(nextScheduledCall(THU_1710, "basic", { day: 0, time: "08:00" })).toEqual(fromRiyadh(2026, 11, 8, 8, 0));
  });

  it("Ultimate: later today, else tomorrow, ignoring any day", () => {
    expect(nextScheduledCall(THU_1710, "ultimate", { day: null, time: "20:00" })).toEqual(fromRiyadh(2026, 11, 5, 20, 0));
    expect(nextScheduledCall(THU_1710, "ultimate", { day: 1, time: "06:00" })).toEqual(fromRiyadh(2026, 11, 6, 6, 0));
  });

  it("uses Riyadh time, not the device time zone", () => {
    // 22:30 UTC on Thursday is already 01:30 Friday in Riyadh.
    const lateUtc = new Date(Date.UTC(2026, 10, 5, 22, 30));
    expect(nextScheduledCall(lateUtc, "ultimate", { day: null, time: "01:00" })).toEqual(fromRiyadh(2026, 11, 7, 1, 0));
    expect(nextScheduledCall(lateUtc, "basic", { day: 5, time: "02:00" })).toEqual(fromRiyadh(2026, 11, 6, 2, 0));
  });
});
