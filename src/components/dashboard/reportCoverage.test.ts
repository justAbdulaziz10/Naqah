import { describe, expect, it } from "vitest";
import { createDemoWorkspace } from "@/domain/seed";
import type { FarmReport } from "@/domain/types";
import { app } from "@/i18n/messages/app";
import { reportResources, unreportedTopics } from "./reportCoverageFacts";

const report: FarmReport = { id: "r", at: "2026-11-09T14:00:00.000Z", callId: "c", answers: [], findings: [] };
const labels = { health: app.en.overview.reportHealthTopic, count: app.en.overview.reportCountTopic, other: app.en.overview.reportOtherTopic };

describe("report provenance", () => {
  it("does not list missing topics for old reports", () => {
    expect(unreportedTopics(createDemoWorkspace("en", "ultimate"), report, labels)).toEqual([]);
  });
  it("lists only not-reported topics, using bilingual resource and custom labels", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    const custom = ws.settings.customQuestions[0];
    const topics = unreportedTopics(ws, { ...report, coverage: [
      { questionId: "feed_level", status: "not_reported" },
      { questionId: "water_level", status: "unknown" },
      { questionId: "herd_health", status: "reported" },
      { questionId: custom.id, status: "not_reported" },
    ] }, labels);
    expect(topics).toEqual([{ ar: "العلف", en: "Feed" }, { ar: custom.text, en: custom.text }]);
  });
  it("never puts an older resource value under this report", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    const feed = ws.resources.find((resource) => resource.kind === "feed")!;
    feed.present = true;
    feed.updatedAt = report.at;
    const water = ws.resources.find((resource) => resource.kind === "water")!;
    water.present = true;
    water.updatedAt = "2026-11-08T14:00:00.000Z";
    expect(reportResources(ws, report).map((resource) => resource.kind)).toEqual(["feed"]);
    expect(reportResources(ws, { ...report, coverage: [{ questionId: "feed_level", status: "not_reported" }] })).toEqual([]);
  });
  it("recognizes equivalent database timestamps without presenting absent supplies", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    for (const resource of ws.resources) {
      resource.updatedAt = "2026-11-09 14:00:00+00";
      resource.present = resource.kind === "water";
    }
    expect(reportResources(ws, report).map((resource) => resource.kind)).toEqual(["water"]);
  });
  it("keeps omission copy natural in Arabic and English", () => {
    expect(app.ar.overview.reportNotMentioned("العلف، الماء")).toBe("ما ذُكر في هذا التحديث: العلف، الماء");
    expect(app.en.overview.reportNotMentioned("Feed, Water")).toBe("Not mentioned in this update: Feed, Water");
  });
});
