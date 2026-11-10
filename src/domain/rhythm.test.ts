import { describe, expect, it } from "vitest";
import { fromRiyadh } from "./clock";
import { reportRhythm } from "./rhythm";
import { createEmptyWorkspace } from "./seed";
import type { Workspace } from "./types";

// Sunday 8 Nov 2026, 08:00 Riyadh.
const SUN_0800 = fromRiyadh(2026, 11, 8, 8, 0);

function daily(createdAt = fromRiyadh(2026, 11, 1, 9, 0)): Workspace {
  const ws = createEmptyWorkspace("ultimate");
  ws.createdAt = createdAt.toISOString();
  ws.settings.callSchedule = { day: null, time: "17:00" };
  return ws;
}

const report = (at: Date) => ({ id: `rpt-${at.getTime()}`, at: at.toISOString(), callId: "c", answers: [], findings: [] });

describe("reportRhythm", () => {
  it("shows only upcoming calls for a ranch with no history", () => {
    const slots = reportRhythm(daily(SUN_0800), SUN_0800);
    expect(slots).toHaveLength(7);
    expect(slots[0].current).toBe(true);
    expect(slots.map((slot) => slot.state)).toEqual(["next", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(slots[0].callAt?.toISOString()).toBe(fromRiyadh(2026, 11, 8, 17, 0).toISOString());
  });

  it("marks saved, missed and quiet days, then the next call", () => {
    const ws = daily();
    ws.reports.push(report(fromRiyadh(2026, 11, 7, 17, 5)));
    ws.reportCalls = [{ id: "r1", occurrence: fromRiyadh(2026, 11, 6, 17, 0).toISOString(), trigger: "schedule", attempts: [], nextAttemptAt: null, state: "missed", reportId: null }];
    const slots = reportRhythm(ws, SUN_0800);
    expect(slots.map((slot) => slot.state)).toEqual(["quiet", "quiet", "missed", "saved", "next", "upcoming", "upcoming"]);
    expect(slots[3].reportAt).toBe(ws.reports[0].at);
  });

  it("does not offer today's call once today's report is in", () => {
    const ws = daily();
    ws.reports.push(report(fromRiyadh(2026, 11, 8, 7, 30)));
    const slots = reportRhythm(ws, SUN_0800);
    const today = slots.find((slot) => slot.current);
    expect(today?.state).toBe("saved");
    expect(slots[slots.indexOf(today!) + 1].state).toBe("next");
  });

  it("calls a passed slot without a report open", () => {
    const ws = daily();
    const slots = reportRhythm(ws, fromRiyadh(2026, 11, 8, 18, 0));
    expect(slots.find((slot) => slot.current)?.state).toBe("open");
  });

  it("does not wait for a call time that passed before the ranch was set up", () => {
    const ws = daily(fromRiyadh(2026, 11, 8, 17, 30));
    const slots = reportRhythm(ws, fromRiyadh(2026, 11, 8, 18, 0));
    expect(slots.find((slot) => slot.current)?.state).toBe("quiet");
    expect(slots[slots.findIndex((slot) => slot.current) + 1].state).toBe("next");
  });

  it("uses weeks on Basic", () => {
    const ws = createEmptyWorkspace("basic");
    ws.createdAt = fromRiyadh(2026, 10, 1).toISOString();
    ws.settings.callSchedule = { day: 4, time: "17:00" };
    const slots = reportRhythm(ws, SUN_0800);
    const current = slots.find((slot) => slot.current)!;
    expect(current.start.toISOString()).toBe(fromRiyadh(2026, 11, 8).toISOString());
    expect(current.callAt?.toISOString()).toBe(fromRiyadh(2026, 11, 12, 17, 0).toISOString());
    expect(current.state).toBe("next");
    expect(slots.filter((slot) => slot.start < current.start)).toHaveLength(4);
  });

  const basicWithRun = (occurrence: Date, result: "answered" | "no_answer"): Workspace => {
    const ws = createEmptyWorkspace("basic");
    ws.createdAt = fromRiyadh(2026, 10, 1).toISOString();
    ws.settings.callSchedule = { day: 4, time: "17:00" };
    ws.reportCalls = [{ id: "r1", occurrence: occurrence.toISOString(), trigger: "manual", attempts: [{ at: occurrence.toISOString(), result }], nextAttemptAt: null, state: "missed", reportId: null }];
    return ws;
  };

  it("keeps this period's scheduled call next after an unanswered Call now", () => {
    const slots = reportRhythm(basicWithRun(SUN_0800, "no_answer"), fromRiyadh(2026, 11, 8, 9, 0));
    const current = slots.find((slot) => slot.current)!;
    expect(current.state).toBe("next");
    expect(current.callAt?.toISOString()).toBe(fromRiyadh(2026, 11, 12, 17, 0).toISOString());
  });

  it("marks a passed period missed only when the call went unanswered", () => {
    const now = fromRiyadh(2026, 11, 15, 8, 0);
    const lastWeek = (ws: Workspace) => reportRhythm(ws, now).find((slot) => slot.start.getTime() === fromRiyadh(2026, 11, 8).getTime())!.state;
    expect(lastWeek(basicWithRun(SUN_0800, "no_answer"))).toBe("missed");
    expect(lastWeek(basicWithRun(SUN_0800, "answered"))).toBe("quiet");
  });
});
