import { describe, expect, it } from "vitest";
import type { Workspace } from "@/domain/types";
import { isSampleWorkerPhone, supplierOrderText, toWaDigits, waLink, workerMessageText } from "./links";

function workspace(): Workspace {
  return {
    version: 1,
    setupComplete: true,
    createdAt: "2026-11-01T10:00:00.000Z",
    settings: {
      plan: "ultimate",
      owner: { name: "Owner", phone: "0500000000" },
      farm: { name: "عزبة النخيل", location: "" },
      worker: { name: "سالم", phone: "٠٥١٢٣٤٥٦٧٨", language: "ar" },
      customQuestions: [],
      criteria: [],
      emergencies: [],
      window: null,
      integrations: { supplierName: "مؤسسة النخيل", supplierPhone: "0509876543" },
    },
    camels: [],
    resources: [
      { kind: "feed", present: true, level: "low", quantity: "12 كيس", note: null, certainty: "reported", updatedAt: null },
      { kind: "water", present: true, level: "critical", quantity: null, note: null, certainty: "reported", updatedAt: null },
      { kind: "medicine", present: true, level: "low", quantity: "2 صناديق", note: null, certainty: "reported", updatedAt: null },
      { kind: "fences", present: false, level: "critical", quantity: null, note: null, certainty: "reported", updatedAt: null },
    ],
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
  };
}

describe("WhatsApp links", () => {
  it.each([
    ["0501234567", "966501234567"],
    ["+966 50 123 4567", "966501234567"],
    ["966 50-123-4567", "966501234567"],
    ["٠٥٠١٢٣٤٥٦٧", "966501234567"],
    ["۰۵۰۱۲۳۴۵۶۷", "966501234567"],
  ])("normalizes %s", (input, expected) => {
    expect(toWaDigits(input)).toBe(expected);
  });

  it.each(["0111234567", "05012345", "966111234567", "+1 202 555 0100", "123456789012"])(
    "rejects invalid Saudi mobile %s",
    (input) => {
      expect(toWaDigits(input)).toBeNull();
    },
  );

  it("builds a digits-only link and escapes the message", () => {
    const url = new URL(waLink("٠٥١٢٣٤٥٦٧٨", "هلا سالم & شكراً")!);
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/966512345678");
    expect(url.searchParams.get("text")).toBe("هلا سالم & شكراً");
    expect(waLink("0111234567", "hello")).toBeNull();
  });

  it("includes farm, low resources, quantities, and supplier in the order text", () => {
    const text = supplierOrderText(workspace(), "ar", ["feed", "water"]);
    expect(text).toContain("مؤسسة النخيل");
    expect(text).toContain("عزبة النخيل");
    expect(text).toContain("العلف: 12 كيس");
    expect(text).toContain("الماء: الكمية غير محددة");
    expect(text).not.toContain("المستلزمات البيطرية");
    expect(supplierOrderText(workspace(), "en", ["fences"])).toBeNull();
  });

  it("creates a worker message in the requested locale", () => {
    expect(workerMessageText(workspace(), "ar")).toContain("هلا سالم");
    expect(workerMessageText(workspace(), "en")).toContain("Hello سالم");
  });
});

describe("sample worker number", () => {
  it.each(["+966 50 778 2190", "0507782190", "966507782190", "٠٥٠٧٧٨٢١٩٠"])("is recognised as %s", (phone) => {
    expect(isSampleWorkerPhone(phone)).toBe(true);
  });
  it.each(["0512345678", "", "not a number"])("does not block %s", (phone) => {
    expect(isSampleWorkerPhone(phone)).toBe(false);
  });
});
