import { describe, expect, it } from "vitest";
import { ownerSummaryText } from "./ownerSummary";
import { createEmptyWorkspace } from "./seed";
import type { FarmReport, ReportCallRun, Workspace } from "./types";

const now = new Date("2026-11-12T15:00:00.000Z"); // Thursday 18:00 Riyadh

function farm(): Workspace {
  const ws = createEmptyWorkspace("basic");
  ws.settings.worker = { ...ws.settings.worker, name: "Ahmed" };
  return ws;
}

const report = (over: Partial<FarmReport> = {}): FarmReport => ({
  id: "rep_1", at: "2026-11-12T14:05:00.000Z", callId: "c", findings: [],
  answers: [
    { questionId: "feed_level", question: { ar: "كم العلف؟", en: "How is the feed?" }, answer: "low", answerText: { ar: "قليل", en: "Low" }, certainty: "approximate", followUp: false },
    { questionId: "custom_1", question: { ar: "البئر؟", en: "The well?" }, answer: "نظيف", certainty: "reported", followUp: false },
    { questionId: "herd_count", question: { ar: "كم العدد؟", en: "How many?" }, answer: "ما أدري", certainty: "unknown", followUp: false },
  ],
  ...over,
});

const failedRun = (at: string): ReportCallRun => ({ id: "r", occurrence: at, trigger: "schedule", attempts: [{ at, result: "no_answer" }], nextAttemptAt: null, state: "missed", reportId: null });

describe("a report summary", () => {
  it("says who reported and when, in Riyadh time", () => {
    const text = ownerSummaryText(farm(), report(), now);
    expect(text.en).toContain("Ahmed reported today at 5:05 PM.");
    expect(text.ar).toContain("وصل تقرير من Ahmed اليوم الساعة 5:05 مساءً.");
  });

  it("reads every recorded detail with its certainty, under a short label", () => {
    const text = ownerSummaryText(farm(), report(), now);
    expect(text.en).toContain("Feed: Low, approximately");
    expect(text.ar).toContain("قليل، تقريبًا");
    expect(text.en).toContain("The well?: نظيف");
    expect(text.en).toContain("Herd count: ما أدري, not certain");
    expect(text.en).not.toContain("How is the feed?");
  });

  it("includes every finding, and does not call a quiet report good news", () => {
    const flagged = ownerSummaryText(farm(), report({ findings: [{ id: "f", criterionId: "c", text: { ar: "العلف قليل", en: "Feed is low" } }] }), now);
    expect(flagged.en).toContain("What matters: Feed is low.");
    const quiet = ownerSummaryText(farm(), report(), now);
    expect(quiet.en).toContain("Nothing in this report matches your important-findings list.");
    expect(quiet.en).not.toMatch(/fine|healthy|good news/i);
  });

  it("names what was not reported, without repeating answered unknowns", () => {
    const ws = farm();
    ws.settings.customQuestions = [{ id: "q9", text: "Did the vet come?", createdAt: now.toISOString() }];
    const text = ownerSummaryText(ws, report({ coverage: [
      { questionId: "water_level", status: "not_reported" },
      { questionId: "q9", status: "not_reported" },
      { questionId: "herd_count", status: "unknown" },
      { questionId: "feed_level", status: "reported" },
    ] }), now);
    expect(text.en).toContain("Not reported: Water; Did the vet come?.");
    expect(text.en.match(/Herd count/g)).toHaveLength(1);
  });

  it("says when a report isn't from today", () => {
    expect(ownerSummaryText(farm(), report({ at: "2026-11-11T09:00:00.000Z" }), now).en).toContain("yesterday at 12:00 PM");
    expect(ownerSummaryText(farm(), report({ at: "2026-11-09T09:00:00.000Z" }), now).en).toContain("on Monday at 12:00 PM");
    expect(ownerSummaryText(farm(), report({ at: "2026-10-20T05:30:00.000Z" }), now).en).toContain("on 20 October at 8:30 AM");
  });
});

describe("the no-report call", () => {
  it("says plainly that nothing has ever arrived", () => {
    const text = ownerSummaryText(farm(), null, now);
    expect(text.en).toBe("No verified report has arrived from Ahmed yet. I have no new information about the ranch.");
    expect(text.ar).toContain("العزبة");
    expect(text.ar).not.toContain("مزرعة");
  });

  it("names when the last report was, without repeating its contents as new", () => {
    const ws = farm();
    ws.reports = [report({ at: "2026-11-05T09:00:00.000Z", findings: [{ id: "f", criterionId: "c", text: { ar: "سر", en: "Old finding" } }] })];
    const text = ownerSummaryText(ws, null, now);
    expect(text.en).toContain("since the last one on 5 November at 12:00 PM");
    expect(text.en).not.toContain("Old finding");
    expect(text.en).not.toContain("Feed");
  });

  it("names when the last call to the worker failed", () => {
    const ws = farm();
    ws.reportCalls = [failedRun("2026-11-12T13:40:00.000Z")];
    expect(ownerSummaryText(ws, null, now).en).toContain("The last call to Ahmed did not go through today at 4:40 PM.");
  });

  it("claims no failure for a call that is still running or ended in a report", () => {
    const ws = farm();
    ws.reportCalls = [{ ...failedRun("2026-11-12T13:40:00.000Z"), state: "answered" }];
    expect(ownerSummaryText(ws, null, now).en).not.toContain("did not go through");
    ws.reportCalls = [{ ...failedRun("2026-11-12T13:40:00.000Z"), state: "completed" }];
    expect(ownerSummaryText(ws, null, now).en).not.toContain("did not go through");
  });

  it("falls back to a role when the worker has no name", () => {
    const ws = farm();
    ws.settings.worker.name = " ";
    expect(ownerSummaryText(ws, null, now).en).toContain("from the worker");
  });
});
