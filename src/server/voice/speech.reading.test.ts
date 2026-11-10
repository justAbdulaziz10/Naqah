import { describe, expect, it } from "vitest";
import type { CallSession, Reply } from "@/domain/conversation/engine";
import { mapSpeechToInput, namedCamels, saysRestAreWell, topicSegments } from "./speech";

const camels = ["نورة", "مزون", "شيخة", "زينة", "بنت الريح"].map((name, index) => ({ id: String(index), name }));
const names = (heard: string) => namedCamels(heard, camels).map((camel) => camel.name);

describe("camel names on the phone", () => {
  it.each([
    ["نورة تعبانة", ["نورة"]],
    ["نورا تعبانة", ["نورة"]],
    ["النوره ما تاكل", ["نورة"]],
    ["نورة ومزون تعبانات", ["نورة", "مزون"]],
    ["ونورة بعد", ["نورة"]],
    ["بنت الريح تعرج", ["بنت الريح"]],
  ])("finds the names in «%s»", (heard, expected) => expect(names(heard)).toEqual(expected));

  it.each(["الحلال زين", "كلهم زين بس وحدة تعبانة", "تمام الحمد لله", "العلف قليل"])("finds no camel in «%s»", (heard) => {
    expect(names(heard)).toEqual([]);
  });

  it("still takes an exact name that is also a word", () => {
    expect(namedCamels("زين تعبان", [{ name: "زين" }])).toHaveLength(1);
  });
});

describe("the rest are well", () => {
  it.each(["كلهم بخير بس نورة تعبانة", "الحلال زين الا نورة", "كلها تمام ما عدا وحدة", "الباقي بخير لكن مزون مسخنة"])("hears it in «%s»", (heard) => {
    expect(saysRestAreWell(heard)).toBe(true);
  });
  it.each(["نورة تعبانة", "تمام بس نورة تعبانة", "كلهم تعبانين بس نورة زينة", "كلهم مو بخير بس نورة"])("does not hear it in «%s»", (heard) => {
    expect(saysRestAreWell(heard)).toBe(false);
  });
});

describe("a sentence about several topics", () => {
  it("splits where the topic changes", () => {
    expect(topicSegments("الحلال بخير والعلف قليل بس الماء كافي")).toEqual([
      { text: "الحلال بخير", topic: "herd" },
      { text: "والعلف قليل", topic: "feed" },
      { text: "بس الماء كافي", topic: "water" },
    ]);
  });

  const levels: Reply[] = ["good", "medium", "low", "critical", "unknown"].map((value) => ({ id: value, value, label: { ar: value, en: value } }));
  const asking = (id: string, resource: "feed" | "water"): CallSession => ({
    scenario: "report_call", step: "report_question", turns: [], replies: levels, inputMode: "choices", done: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] },
    data: { reportIndex: 0, queue: [{ kind: "predefined", id, question: { ar: "", en: "" }, answerKind: "level", resource }] }, notices: [],
  });

  it("reads only the part about the asked topic", () => {
    expect(mapSpeechToInput(asking("feed_level", "feed"), "العلف كافي والماي قليل")).toEqual({ value: "good" });
    expect(mapSpeechToInput(asking("water_level", "water"), "العلف كافي والماي قليل")).toEqual({ value: "low" });
  });

  it("keeps words that name no topic with the answer", () => {
    expect(mapSpeechToInput(asking("feed_level", "feed"), "زين، والماي قليل")).toEqual({ value: "good" });
  });
});
