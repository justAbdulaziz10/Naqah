import { describe, expect, it } from "vitest";
import { completeWorkerReport } from "./actions";
import { fromRiyadh } from "./clock";
import type { ReportDraft } from "./findings";
import { createEmptyWorkspace } from "./seed";
import { isCompleteCallSchedule, nextScheduledCall, upcomingReportCall } from "./schedule";

// Thursday 5 Nov 2026, 17:10 Riyadh.
const THU_1710 = fromRiyadh(2026, 11, 5, 17, 10);
const emptyDraft: ReportDraft = {
  answers: [],
  camelUpdates: [],
  resourceUpdates: [],
  herdAccountedFor: true,
  taskConfirmations: [],
};

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

  it("skips the remaining Basic weekly slot only when the completed report is in this Riyadh week", () => {
    const ws = createEmptyWorkspace("basic");
    ws.settings.callSchedule = { day: 4, time: "17:00" };
    const now = fromRiyadh(2026, 11, 5, 16, 0);
    expect(upcomingReportCall(ws, now)).toEqual(fromRiyadh(2026, 11, 5, 17, 0));

    const reported = completeWorkerReport(ws, fromRiyadh(2026, 11, 5, 15, 0), emptyDraft).ws;
    expect(upcomingReportCall(reported, now)).toEqual(fromRiyadh(2026, 11, 12, 17, 0));

    const sundaySchedule = { ...ws, settings: { ...ws.settings, callSchedule: { day: 0 as const, time: "09:00" } } };
    const beforeWeekBoundary = completeWorkerReport(sundaySchedule, fromRiyadh(2026, 11, 7, 23, 55), emptyDraft).ws;
    expect(upcomingReportCall(beforeWeekBoundary, fromRiyadh(2026, 11, 8, 0, 5))).toEqual(fromRiyadh(2026, 11, 8, 9, 0));
  });

  it("skips the remaining Ultimate daily slot only when the completed report is in today’s Riyadh day", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.settings.callSchedule = { day: null, time: "17:00" };
    const now = fromRiyadh(2026, 11, 5, 9, 0);
    expect(upcomingReportCall(ws, now)).toEqual(fromRiyadh(2026, 11, 5, 17, 0));

    const reported = completeWorkerReport(ws, fromRiyadh(2026, 11, 5, 8, 0), emptyDraft).ws;
    expect(upcomingReportCall(reported, now)).toEqual(fromRiyadh(2026, 11, 6, 17, 0));

    const beforeDayBoundary = completeWorkerReport(ws, fromRiyadh(2026, 11, 5, 23, 55), emptyDraft).ws;
    expect(upcomingReportCall(beforeDayBoundary, fromRiyadh(2026, 11, 6, 0, 5))).toEqual(fromRiyadh(2026, 11, 6, 17, 0));
  });
});
