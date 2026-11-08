import { describe, expect, it } from "vitest";
import type { FarmReport } from "@/domain/types";
import { buildOwnerCallSummary, buildOwnerSummary } from "./summary";

const report: FarmReport = {
  id: "rep_1", at: "2026-01-01T00:00:00.000Z", callId: "call_1",
  answers: [{
    questionId: "feed", question: { ar: "العلف", en: "Feed" }, answer: "20 bags",
    answerText: { ar: "٢٠ كيس", en: "20 bags" }, certainty: "approximate", followUp: false,
  }],
  findings: [{ id: "f_1", criterionId: "c_1", text: { ar: "ناقة تحت الملاحظة", en: "A camel needs watching" } }],
};

describe("owner report summary", () => {
  it("labels the sample, then localizes findings and fixed-choice facts", () => {
    expect(buildOwnerSummary(report, "ar")).toContain("تحديث تجريبي");
    expect(buildOwnerSummary(report, "en")).toContain("not saved to a real farm");
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

  it("builds a short spoken owner call with a headline and findings", () => {
    const long = {
      ...report,
      findings: Array.from({ length: 20 }, (_, index) => ({
        id: `finding_${index}`, criterionId: `criterion_${index}`, text: { ar: "ملاحظة مهمة ".repeat(30), en: "Important finding ".repeat(30) },
      })),
    };
    const summary = buildOwnerCallSummary(long, "en");
    expect(summary).toContain("Sample update from the demo farm.");
    expect(summary).toContain("Important findings:");
    expect(summary.length).toBeLessThanOrEqual(600);
    expect(summary.endsWith("…")).toBe(true);
  });
});
