import { describe, expect, it } from "vitest";
import type { PlatformEvent } from "@/domain/types";
import { buildNotification, selectNotificationEvents } from "./notifications";

function event(id: string, tone: PlatformEvent["tone"], en: string, ar = "حدث في العزبة"): PlatformEvent {
  return { id, at: "2026-11-05T08:00:00.000Z", tone, text: { en, ar } };
}

describe("selectNotificationEvents", () => {
  it("selects attention, danger, findings, and owner-call summaries", () => {
    const events = [
      event("finding", "attention", "1 finding matches the owner's criteria"),
      event("danger", "danger", "A dangerous event"),
      event("owner-call", "success", "The agent called the owner with the update", "اتصل المساعد بالمالك وأبلغه بالتحديث"),
      event("routine", "success", "A routine event"),
      event("neutral", "neutral", "A neutral event"),
    ];

    expect(selectNotificationEvents(events).map(({ id }) => id)).toEqual(["finding", "danger", "owner-call"]);
  });

  it("never announces a retired No Answer Ticket from saved history", () => {
    const events = [
      event("en", "attention", "After 3 retries a No Answer Ticket was opened — waiting for the worker to call back"),
      event("ar", "attention", "Old", "فُتحت تذكرة «عدم رد» بعد المحاولات"),
    ];
    expect(selectNotificationEvents(events)).toEqual([]);
  });

  it("skips ids already seen and duplicate ids within the same batch", () => {
    const repeated = event("same", "danger", "Important event");
    const events = [repeated, repeated, event("seen", "attention", "Old event")];
    expect(selectNotificationEvents(events, new Set(["seen"]))).toEqual([repeated]);
  });
});

describe("buildNotification", () => {
  it("uses the event's Arabic copy and opens the overview", () => {
    const result = buildNotification(event("finding-1", "attention", "1 finding", "ملاحظة مهمة"), "ar");

    expect(result).toEqual({
      title: "ناقة (تجريبي) | مستجد مهم في العزبة",
      body: "ملاحظة مهمة",
      url: "/ar/app",
      tag: "naqah-finding-1",
    });
  });

  it("localizes the owner-call title and destination", () => {
    expect(buildNotification(event("call-1", "success", "The agent called the owner with the update"), "en")).toEqual({
      title: "NAQAH (Demo) | Owner call",
      body: "The agent called the owner with the update",
      url: "/en/app/calls",
      tag: "naqah-call-1",
    });
  });
});
