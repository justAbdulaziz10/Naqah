import { describe, expect, it } from "vitest";
import { completeWorkerReport } from "./actions";
import { evaluateFindings, type ReportDraft } from "./findings";
import { createDemoWorkspace } from "./seed";

const now = new Date("2026-11-09T14:00:00.000Z");
const draft = (extra: Partial<ReportDraft> = {}): ReportDraft => ({
  answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [], ...extra,
});

describe("report coverage", () => {
  it("retains mode, unknowns and omissions without changing untouched farm facts", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    const input = draft({ mode: "open", coverage: [
      { questionId: "water_level", status: "unknown" },
      { questionId: "feed_level", status: "not_reported" },
      { questionId: "herd_health", status: "not_reported" },
    ], answers: [{ questionId: "water_level", question: { ar: "الماء", en: "Water" }, answer: "I don't know", certainty: "unknown", followUp: false }] });
    const result = completeWorkerReport(ws, now, input);
    expect(result.report).toMatchObject({ mode: "open", coverage: input.coverage, answers: input.answers });
    expect(result.ws.camels).toEqual(ws.camels);
    expect(result.ws.resources).toEqual(ws.resources);
    expect(result.report.findings).toEqual([]);
    input.coverage![0].status = "reported";
    expect(result.report.coverage![0].status).toBe("unknown");
  });

  it("never applies stale facts or fires findings for explicitly unreported topics", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    const input = draft({ coverage: ["herd_health", "herd_count", "feed_level", "custom"].map((questionId) => ({ questionId, status: "not_reported" })),
      answers: [{ questionId: "custom", question: { ar: "س", en: "q" }, answer: "danger", certainty: "reported", followUp: false }],
      camelUpdates: [{ camelId: ws.camels[0].id, health: "sick", note: "Old note", certainty: "reported" }],
      resourceUpdates: [{ kind: "feed", level: "critical", quantity: "1", note: null, certainty: "reported" }],
      herdAccountedFor: false, herdCount: 1,
    });
    ws.settings.criteria.push({ id: "custom_criterion", kind: "custom", label: "danger", enabled: true });
    expect(evaluateFindings(ws, input)).toEqual([]);
    const result = completeWorkerReport(ws, now, input);
    expect(result.ws.camels).toEqual(ws.camels);
    expect(result.ws.resources).toEqual(ws.resources);
    expect(result.report.answers).toEqual([]);
    expect(result.report.herdCountReported).toBeUndefined();
  });

  it("records one urgent worker concern without turning it into a diagnosis", () => {
    const result = completeWorkerReport(createDemoWorkspace("en", "ultimate"), now, draft({ urgentNote: "She is not standing" }));
    expect(result.report.findings).toHaveLength(1);
    expect(result.report.findings[0]).toMatchObject({ criterionId: "worker_urgent", text: {
      ar: "ملاحظة عاجلة بحسب إفادة العامل: She is not standing",
      en: "Urgent concern reported by the worker: She is not standing",
    } });
  });

  it("rejects duplicate coverage before changing state", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    expect(() => completeWorkerReport(ws, now, draft({ coverage: [
      { questionId: "feed_level", status: "reported" }, { questionId: "feed_level", status: "not_reported" },
    ] }))).toThrow("coverage");
  });

  it("rejects duplicate resource kinds instead of finding the first and saving the last", () => {
    const updates: ReportDraft["resourceUpdates"] = ["critical", "good"].map((level) => ({
      kind: "feed", level: level as "critical" | "good", quantity: null, note: null, certainty: "reported",
    }));
    expect(() => completeWorkerReport(createDemoWorkspace("en", "ultimate"), now, draft({ resourceUpdates: updates }))).toThrow("resourceUpdates");
  });

  it("still saves an old draft without mode or coverage", () => {
    const result = completeWorkerReport(createDemoWorkspace("en", "ultimate"), now, draft());
    expect(result.report.mode).toBeUndefined();
    expect(result.report.coverage).toBeUndefined();
  });
});
