import { describe, expect, it } from "vitest";
import type { FarmReport } from "@/domain/types";
import { buildOwnerSummary } from "./summary";

const report: FarmReport = {
  id: "rep_1", at: "2026-01-01T00:00:00.000Z", callId: "call_1",
  answers: [{
    questionId: "feed", question: { ar: "العلف", en: "Feed" }, answer: "20 bags",
    answerText: { ar: "٢٠ كيس", en: "20 bags" }, certainty: "approximate", followUp: false,
  }],
  findings: [{ id: "f_1", criterionId: "c_1", text: { ar: "ناقة تحت الملاحظة", en: "A camel needs watching" } }],
};

describe("owner report summary", () => {
  it("localizes saved status, findings, and fixed-choice facts", () => {
    expect(buildOwnerSummary(report, "ar")).toContain("حُفظ تحديث المزرعة.");
    expect(buildOwnerSummary(report, "ar")).toContain("ناقة تحت الملاحظة");
    expect(buildOwnerSummary(report, "en")).toContain("Feed: 20 bags");
    expect(buildOwnerSummary(report, "en")).toContain("Important findings:");
  });

  it("caps the body length for provider limits", () => {
    const long = { ...report, answers: Array.from({ length: 100 }, (_, index) => ({
      ...report.answers[0], question: { ar: `س${index}`, en: `Q${index}` }, answer: "x".repeat(200), answerText: undefined,
    })) };
    expect(buildOwnerSummary(long, "en").length).toBeLessThanOrEqual(4_000);
  });
});
