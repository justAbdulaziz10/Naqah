import { describe, expect, it } from "vitest";
import { callQuestionPlan } from "./callQuestions";
import { PREDEFINED_QUESTIONS } from "./catalog";
import { createEmptyWorkspace } from "./seed";
import type { Workspace } from "./types";

const withResources = (ws: Workspace, present: Record<string, boolean>): Workspace => ({
  ...ws,
  resources: ws.resources.map((resource) => (resource.kind in present ? { ...resource, present: present[resource.kind] } : resource)),
});

describe("the next call's questions", () => {
  it("asks every applicable question once a herd size is known, in catalog order", () => {
    const ws = createEmptyWorkspace();
    const plan = callQuestionPlan({ ...ws, settings: { ...ws.settings, herdCount: 40 } });
    const present = new Set(ws.resources.filter((resource) => resource.present).map((resource) => resource.kind));
    const expected = PREDEFINED_QUESTIONS.filter((question) => question.requires === null || present.has(question.requires));
    expect(plan.asked.map((question) => question.id)).toEqual(expected.map((question) => question.id));
    expect(plan.asked.length + plan.skipped.length).toBe(PREDEFINED_QUESTIONS.length);
  });

  it("skips the herd check until a herd size is known, and resources the ranch doesn't have", () => {
    const ws = withResources(createEmptyWorkspace(), { shelter: false, feed: true });
    const plan = callQuestionPlan(ws);
    expect(plan.asked.some((question) => question.id === "herd_count")).toBe(false);
    expect(plan.skipped).toContainEqual(expect.objectContaining({ reason: "herd_count" }));
    expect(plan.skipped).toContainEqual(expect.objectContaining({ reason: "resource", resource: "shelter" }));
    expect(plan.asked.some((question) => question.id === "feed_level")).toBe(true);
  });

  it("adds the owner's questions after NAQAH's, and open tasks only on Ultimate", () => {
    const basic = createEmptyWorkspace("basic");
    const custom = [{ id: "cq_1", text: "Did the vet visit?", createdAt: "2026-11-08T00:00:00.000Z" }];
    expect(callQuestionPlan({ ...basic, settings: { ...basic.settings, customQuestions: custom } }).custom).toEqual(custom);
    expect(callQuestionPlan(basic).checksTasks).toBe(false);
    expect(callQuestionPlan(createEmptyWorkspace("ultimate")).checksTasks).toBe(true);
  });
});
