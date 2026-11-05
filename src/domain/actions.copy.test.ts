import { describe, expect, it } from "vitest";
import { completeWorkerReport } from "./actions";
import { createEmptyWorkspace } from "./seed";

const now = new Date("2026-11-08T09:00:00.000Z");
const finding = (id: string) => ({ id, criterionId: "c", text: { ar: "ن", en: "n" } });
const report = (count: number) => {
  const { ws } = completeWorkerReport(createEmptyWorkspace("ultimate"), now, {
    answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [],
    extraFindings: Array.from({ length: count }, (_, index) => finding(`f${index}`)),
  });
  return { summary: ws.calls.at(-1)?.summary.en, events: ws.events.map((event) => event.text.en), findings: ws.reports[0].findings.length };
};

describe("report wording", () => {
  it("reads naturally for one finding", () => {
    const { summary, events } = report(1);
    expect(summary).toBe("Update completed — 1 important finding");
    expect(events).toContain("1 finding matches the owner's criteria");
  });
  it("reads naturally for several, and keeps every finding", () => {
    const { summary, events, findings } = report(3);
    expect(summary).toBe("Update completed — 3 important findings");
    expect(events).toContain("3 findings match the owner's criteria");
    expect(findings).toBe(3);
  });
});
