import { describe, expect, it } from "vitest";
import { answer, start, type CallSession } from "@/domain/conversation/engine";
import { fromRiyadh } from "@/domain/clock";
import { createDemoWorkspace } from "@/domain/seed";
import { mapSpeechToInput } from "../speech";
import { askedToStop, refuseAnswer } from "./answer-check";
import { validateFacts } from "./facts";
import { askedTopic, isOffTopicAnswer } from "@/domain/conversation/answer-topic";

const NOW = fromRiyadh(2026, 11, 5, 17, 10);

function at(id: string): CallSession {
  const ws = createDemoWorkspace("ar", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
  const started = start(ws, NOW, "report_call");
  const ringing = started.commit?.(ws) ?? ws;
  const session = answer(started.session, ringing, NOW, { value: "answer" }).session;
  const index = session.data.queue?.findIndex((item) => item.id === id) ?? -1;
  expect(index).toBeGreaterThanOrEqual(0);
  const replies = id === "feed_level" ? ["good", "medium", "low", "critical", "unknown"].map((value) => ({ id: value, value, label: { ar: value, en: value } })) : session.replies;
  return { ...session, replies, step: "report_question", data: { ...session.data, reportIndex: index } };
}

describe("worker words against the chosen answer", () => {
  const health = at("herd_health");
  const feed = at("feed_level");

  it.each(["العلف زين", "الماء تمام", "السور سليم", "the feed is fine"])("refuses %s as a herd-health answer", (heard) => {
    expect(refuseAnswer(health, { value: "yes" }, heard, "ar")).toBe("answer_off_topic");
  });

  it.each(["كلها بخير", "الحلال زين", "الحمد لله", "زين", "ما فيها شي", "لا ما فيه مريض"])("accepts %s as a herd-health answer", (heard) => {
    expect(refuseAnswer(health, { value: "yes" }, heard, "ar")).toBeNull();
  });

  it("keeps a reply that answers the question and adds something else", () => {
    expect(refuseAnswer(health, { value: "yes" }, "الحلال زين بس العلف خلص", "ar")).toBeNull();
  });

  it("does not record all camels well without words that say so", () => {
    expect(refuseAnswer(health, { value: "yes" }, "الجو حار اليوم", "ar")).toBe("answer_unclear");
    expect(refuseAnswer(health, { value: "yes" }, "", "ar")).toBe("answer_unclear");
    expect(refuseAnswer(health, { value: "unknown" }, "ما أدري", "ar")).toBeNull();
    expect(refuseAnswer(health, { value: "no" }, "وحدة تعبانة", "ar")).toBeNull();
  });

  it("never flips a chosen value to get past an evidence refusal", () => {
    const chosen = { value: "no" };
    expect(refuseAnswer(health, chosen, "لا ما فيه مريض", "ar")).toBe("answer_conflicts_with_words");
    expect(chosen).toEqual({ value: "no" });
  });

  it("treats a camel name as the topic", () => {
    expect(refuseAnswer(health, { value: "no" }, "مبروكة والعلف", "ar", ["مبروكة"])).toBeNull();
  });

  it("leaves short replies on stock questions alone", () => {
    expect(refuseAnswer(feed, { value: "low" }, "باقي شوي", "ar")).toBeNull();
    expect(refuseAnswer(feed, { value: "good" }, "الحلال زين", "ar")).toBe("answer_off_topic");
    expect(refuseAnswer(feed, { value: "good" }, null, "ar")).toBeNull();
  });

  it.each([null, "", "   "])("never records herd-health no without actual words (%s)", (heard) => {
    expect(refuseAnswer(health, { value: "no" }, heard, "ar")).toBe("answer_unclear");
  });

  it("refuses a sick-camel answer classified as all healthy and a healthy answer classified as sick", () => {
    expect(refuseAnswer(health, { value: "yes" }, "a camel is sick", "en")).toBe("answer_conflicts_with_words");
    expect(refuseAnswer(health, { value: "no" }, "all camels are well", "en")).toBe("answer_conflicts_with_words");
  });

  it("checks numbers against real words, including in Lab's shared guard", () => {
    const count = { ...at("herd_count"), inputMode: "number" as const };
    expect(refuseAnswer(count, { text: "12" }, "ten camels", "en")).toBe("number_not_in_answer");
    expect(refuseAnswer(count, { text: "12" }, "twelve camels", "en")).toBeNull();
    expect(refuseAnswer(count, { text: "12" }, null, "en")).toBe("number_not_in_answer");
  });

  it("keeps the asked feed topic at the feed question", () => {
    expect(askedTopic(feed)).toBe("feed");
    expect(isOffTopicAnswer(feed, "a camel is sick")).toBe(true);
    expect(isOffTopicAnswer(feed, "الناقه تعرج")).toBe(true);
  });
});

describe("open facts evidence", () => {
  const workspace = createDemoWorkspace("ar", "ultimate", NOW);
  const session = at("herd_health");
  const validate = (facts: unknown[], heard: string) => validateFacts(facts, heard, session, workspace, "ar");
  const feed = { type: "resource", resource: "feed", level: "low", quantity: null, evidence: "feed is low" };

  it("drops feed facts whose evidence is about a sick camel", () => {
    expect(validate([{ ...feed, evidence: "a camel is sick" }], "a camel is sick")).toEqual({ facts: [], dropped: true });
    expect(validate([{ type: "resource", resource: "feed", evidence: "a camel is sick" }], "a camel is sick").facts).toEqual([]);
  });

  it("requires normalized evidence to occur in the actual worker utterance", () => {
    expect(validate([feed], "water is low").facts).toEqual([]);
    expect(validate([feed], "The feed is low, and I am here").facts).toHaveLength(1);
    expect(validate([{ ...feed, evidence: "العلف ناقص" }], "العَلَف ناقص").facts).toHaveLength(1);
  });

  it("drops unsupported numbers, statuses and model-assigned certainty", () => {
    expect(validate([{ ...feed, quantity: 12 }], "feed is low").facts).toEqual([]);
    expect(validate([{ ...feed, quantity: 12, evidence: "feed twelve bags low" }], "feed twelve bags low").facts).toHaveLength(1);
    expect(validate([{ ...feed, level: "good" }], feed.evidence).facts).toEqual([{ type: "other", note: feed.evidence, evidence: feed.evidence }]);
    expect(validate([{ ...feed, certainty: "verified" }], feed.evidence).facts).toEqual([]);
    expect(validate([{ type: "herd_count", count: 42, evidence: "forty two camels" }], "forty two camels").facts).toHaveLength(1);
    expect(validate([{ type: "herd_count", count: 43, evidence: "forty two camels" }], "forty two camels").facts).toEqual([]);
  });

  it("keeps a denied condition as the worker's words, not as the condition", () => {
    const sick = { type: "camel_health", scope: "one", status: "sick", note: null, camelId: null, evidence: "ناقة مريضة" };
    const facts = validate([sick], "ما فيه ناقة مريضة").facts;
    expect(facts).toEqual([{ type: "other", note: "ما فيه ناقة مريضة", evidence: "ما فيه ناقة مريضة" }]);
    expect(validate([sick], "فيه ناقة مريضة").facts[0]).toMatchObject({ type: "camel_health", status: "sick" });
    expect(validate([feed], "the feed is not low").facts).toEqual([{ type: "other", note: "feed is not low", evidence: "feed is not low" }]);
  });

  it("does not treat a leading «لا» as a denial", () => {
    const sick = { type: "camel_health", scope: "one", status: "sick", note: null, camelId: null, evidence: "ناقة مريضة" };
    expect(validate([sick], "لا، ناقة مريضة").facts[0]).toMatchObject({ type: "camel_health" });
    const out = { type: "resource", resource: "feed", level: "critical", quantity: null, evidence: "العلف خلص" };
    expect(validate([out], "لا العلف خلص").facts[0]).toMatchObject({ type: "resource" });
    expect(validate([sick], "لا ناقة مريضة").facts[0]).toMatchObject({ type: "other" });
  });

  it("keeps a camel id only when its farm camel's name is in the evidence", () => {
    const camel = workspace.camels[0];
    const base = { type: "camel_health", scope: "one", status: "sick", note: null, camelId: camel.id };
    const named = camel.name + " is sick";
    expect(validate([{ ...base, evidence: named }], named).facts[0]).toMatchObject({ camelId: camel.id });
    expect(validate([{ ...base, evidence: "a camel is sick" }], "a camel is sick").facts[0]).toMatchObject({ camelId: null });
    expect(validate([{ ...base, camelId: "not-a-farm-camel", evidence: named }], named).facts[0]).toMatchObject({ camelId: null });
  });

  it("requires explicit all-camels words before changing the entire herd", () => {
    const base = { type: "camel_health", scope: "all", status: "healthy", note: null, camelId: null };
    expect(validate([{ ...base, evidence: "a camel is healthy" }], "a camel is healthy").facts).toEqual([]);
    expect(validate([{ ...base, evidence: "all camels are healthy" }], "all camels are healthy").facts).toHaveLength(1);
    expect(validate([{ ...base, evidence: "كل الحلال بخير" }], "كل الحلال بخير").facts).toHaveLength(1);
  });

  it("accepts a custom answer only for a queued custom question and with actual words", () => {
    const custom = { type: "custom", questionId: "owner-question", answer: "the gate is blue", evidence: "the gate is blue" };
    expect(validate([custom], custom.evidence).facts).toEqual([]);
    const queued = { ...session, data: { ...session.data, queue: [...session.data.queue!, { kind: "custom" as const, id: custom.questionId, question: { ar: "لون الباب؟", en: "Gate color?" } }] } };
    expect(validateFacts([custom], custom.evidence, queued, workspace, "en").facts).toHaveLength(1);
    expect(validateFacts([{ ...custom, answer: "the gate is red" }], custom.evidence, queued, workspace, "en").facts).toEqual([]);
  });
});

describe("natural Arabic answers", () => {
  const health = at("herd_health");
  const feed = at("feed_level");
  it.each([
    "تمام الحمد لله بس في واحدة تعبانة.",
    "تمام الحمد لله الحلال بس إنه في واحدة تعبانة.",
    "كلهم تمام، ألا في وحدة تعبانه.",
    "كلهم تمام بس وحدة تعبانة",
    "زينين كلهم ما عدا وحدة تعرج",
    "الحمد لله بس فيه ناقة ما تاكل",
  ])("accepts «%s» as one needing attention", (heard) => {
    expect(mapSpeechToInput(health, heard, null, "ar")).toEqual({ value: "no" });
    expect(refuseAnswer(health, { value: "no" }, heard, "ar")).toBeNull();
    expect(refuseAnswer(health, { value: "yes" }, heard, "ar")).toBe("answer_conflicts_with_words");
  });

  it.each(["الحمد لله كلهم بخير", "ما فيه مريضة", "ما عليهم خلاف", "زينين"])("accepts «%s» as all well", (heard) => {
    expect(mapSpeechToInput(health, heard, null, "ar")).toEqual({ value: "yes" });
  });

  it.each([["زين بس قرب يخلص", "low"], ["العلف كافي بس ناقص شوي", "low"], ["خلص العلف", "critical"], ["مليان", "good"], ["مو كافي", "low"]])("reads «%s» on feed as %s", (heard, value) => {
    expect(mapSpeechToInput(feed, heard, null, "ar")).toEqual({ value });
  });

  it("trusts the model's reading of a natural phrase it can't find in the word list", () => {
    expect(refuseAnswer(feed, { value: "good" }, "والله الوضع ماشي الحال", "ar")).toBeNull();
  });

  it.each(["أنا بخير الحمد لله", "لو بخير", "أنا تعبان", "إذا بخير"])("does not take «%s» as a report on the camels", (heard) => {
    expect(mapSpeechToInput(health, heard, null, "ar")).toBeNull();
    expect(refuseAnswer(health, { value: "yes" }, heard, "ar")).toBe("answer_unclear");
    expect(refuseAnswer(health, { value: "no" }, heard, "ar")).toBe("answer_unclear");
  });

  it("still accepts a first-person sentence about the camels", () => {
    expect(mapSpeechToInput(health, "أنا شفت الحلال بخير", null, "ar")).toEqual({ value: "yes" });
  });

  it("does not guess from unclear or unrelated words", () => {
    expect(refuseAnswer(feed, { value: "good" }, "كاسييا", "ar")).toBe("answer_unclear");
    expect(refuseAnswer(health, { value: "no" }, "الجو حار اليوم", "ar")).toBe("answer_unclear");
    expect(refuseAnswer(health, { value: "yes" }, "إيه", "ar")).toBe("answer_unclear");
  });

  it("does not let another topic in the sentence contradict the answer", () => {
    expect(refuseAnswer(feed, { value: "good" }, "العلف زين بس الماء قرب يخلص", "ar")).toBeNull();
  });
});

describe("asking not to record", () => {
  it.each(["تراني بلغت المعزب، لا تسجل شي", "لا تسجله", "لا تحفظ شي"])("«%s» lets the call end without saving", (heard) => {
    expect(askedToStop(heard)).toBe(true);
  });
  it.each(["سجل إن مزون تعبانة", "تسجل كل شي؟"])("«%s» is not a stop", (heard) => {
    expect(askedToStop(heard)).toBe(false);
  });
});
