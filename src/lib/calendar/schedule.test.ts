import { describe, expect, it } from "vitest";
import type { TaskTicket, Workspace } from "@/domain/types";
import {
  decodeSchedule,
  encodeSchedule,
  MAX_SCHEDULE_BYTES,
  MAX_SCHEDULE_TASKS,
  scheduleForTask,
  scheduleFromWorkspace,
} from "./schedule";

function ticket(id: string, scheduledFor: string | null, status: TaskTicket["status"] = "open"): TaskTicket {
  return {
    id,
    instruction: "أعطِ الناقة ماءً",
    createdAt: "2026-11-01T10:00:00.000Z",
    scheduledFor,
    status,
    closedAt: status === "closed" ? "2026-11-02T10:00:00.000Z" : null,
    closedVia: null,
  };
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    version: 1,
    setupComplete: true,
    createdAt: "2026-11-01T10:00:00.000Z",
    settings: {
      plan: "basic",
      owner: { name: "Owner", phone: "0500000000" },
      farm: { name: "عزبة النخيل", location: "" },
      worker: { name: "Worker", phone: "0500000001", language: "ar" },
      customQuestions: [],
      criteria: [],
      emergencies: [],
      window: null,
      callSchedule: { day: 4, time: "16:00" },
    },
    camels: [],
    resources: [],
    lastUpdateAt: null,
    reports: [],
    calls: [],
    taskTickets: [],
    noAnswerTickets: [],
    pendingWorkerCalls: [],
    relays: [],
    events: [],
    clockOffsetMs: 0,
    ownerAllowanceUsedAt: null,
    missedNotificationAt: null,
    ...overrides,
  };
}

describe("calendar schedule", () => {
  it("snapshots the Basic call slot and only open scheduled tasks", () => {
    const ws = workspace({
      taskTickets: [
        ticket("later", "2026-11-09T10:00:00.000Z"),
        ticket("any-time", null),
        ticket("closed", "2026-11-07T10:00:00.000Z", "closed"),
        ticket("sooner", "2026-11-06T10:00:00.000Z"),
      ],
    });

    expect(scheduleFromWorkspace(ws, "ar")).toEqual({
      v: 1,
      l: "ar",
      f: "عزبة النخيل",
      p: "basic",
      w: { day: 4, start: "16:00", end: "16:30" },
      t: [
        { id: "sooner", title: "أعطِ الناقة ماءً", at: "2026-11-06T10:00:00.000Z" },
        { id: "later", title: "أعطِ الناقة ماءً", at: "2026-11-09T10:00:00.000Z" },
      ],
    });
  });

  it("uses the daily call time for Ultimate and creates a single-task snapshot", () => {
    const basic = workspace();
    const ws = workspace({
      settings: { ...basic.settings, plan: "ultimate", callSchedule: { day: null, time: "18:00" } },
    });
    const scheduled = ticket("one", "2026-11-09T10:00:00.000Z");

    expect(scheduleFromWorkspace(ws, "en").w).toEqual({ day: 0, start: "18:00", end: "18:30" });
    expect(scheduleFromWorkspace(workspace({ settings: { ...basic.settings, callSchedule: { day: null, time: "18:00" } } }), "en").w).toBeNull();
    expect(scheduleForTask(ws, scheduled, "en")?.t).toEqual([
      { id: "one", title: "أعطِ الناقة ماءً", at: "2026-11-09T10:00:00.000Z" },
    ]);
    expect(scheduleForTask(ws, ticket("any-time", null), "en")).toBeNull();
  });

  it("round-trips Arabic text as base64url UTF-8 JSON", () => {
    const schedule = scheduleFromWorkspace(workspace(), "ar");
    const encoded = encodeSchedule(schedule);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSchedule(encoded)).toEqual(schedule);
  });

  it("preserves task newlines for RFC text escaping", () => {
    const schedule = {
      v: 1 as const,
      l: "en" as const,
      f: "Farm",
      p: "ultimate" as const,
      w: null,
      t: [{ id: "task-1", title: "Check feed\r\nthen water", at: "2026-11-09T10:00:00.000Z" }],
    };
    expect(decodeSchedule(encodeSchedule(schedule))?.t[0]?.title).toBe("Check feed\r\nthen water");
  });

  it("rejects malformed, oversized, invalid, or over-task-limit input", () => {
    expect(decodeSchedule(null)).toBeNull();
    expect(decodeSchedule("%%%")).toBeNull();
    expect(decodeSchedule("A".repeat(4097))).toBeNull();
    expect(() =>
      encodeSchedule({
        v: 1,
        l: "en",
        f: "Farm",
        p: "ultimate",
        w: null,
        t: Array.from({ length: MAX_SCHEDULE_TASKS + 1 }, (_, index) => ({
          id: String(index),
          title: "Task",
          at: "2026-11-09T10:00:00.000Z",
        })),
      }),
    ).toThrow("Invalid calendar schedule");
    expect(() =>
      encodeSchedule({
        v: 1,
        l: "en",
        f: "Farm",
        p: "ultimate",
        w: null,
        t: Array.from({ length: MAX_SCHEDULE_TASKS }, (_, index) => ({
          id: "task-" + index,
          title: "x".repeat(160),
          at: "2026-11-09T10:00:00.000Z",
        })),
      }),
    ).toThrow("Calendar schedule is too large");
    expect(MAX_SCHEDULE_BYTES).toBe(3072);
  });
});
