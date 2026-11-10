import { describe, expect, it } from "vitest";
import { answer, start } from "@/domain/conversation/engine";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { demoHistory, demoSettings } from "../../../../scripts/demo/presentation-ranch";
import { NOW } from "./saudi-cases";
import { buildNaturalInstructions, naturalize, naturalOpening, naturalTools, replayAnswers } from "./natural";

function base() {
  const ranch = demoHistory(demoSettings(NOW), NOW, { endYesterday: true });
  const opened = startReportCall(ranch, NOW, "manual");
  const ws = resolveReportCallAttempt(placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws, NOW, opened.run!.id, true).ws;
  return { ws, session: start(ws, NOW, "report_call", { reportCallId: opened.run!.id }).session };
}

const ids = (session: ReturnType<typeof base>["session"]) => (session.data.queue ?? []).map((item) => item.id);

/** What a natural conversation hands over after the worker's free answers on the demo ranch. */
function answers(session: ReturnType<typeof base>["session"]) {
  const [herd, count, feed, water, fences, shelter, medicine, milk, visitor, task] = ids(session);
  return [
    { question_id: herd, value: "no", rest_well: true, camels: [{ name: "مزون", status: "sick", note: "مزون للحين تعبانة" }, { name: "وضحة", status: "watch", note: "وضحة ما تاكل زين" }] },
    { question_id: count, number: 20 },
    { question_id: feed, number: 25 },
    { question_id: water, value: "good" },
    { question_id: fences, value: "good" },
    { question_id: shelter, value: "good" },
    { question_id: medicine, value: "low" },
    { question_id: milk, text: "يمكن ثلاثين لتر" },
    { question_id: visitor, value: "unknown" },
    { question_id: task, value: "yes" },
  ];
}

describe("the natural call", () => {
  it("opens in Saudi Arabic with the worker's and the ranch's names, and asks about the herd", () => {
    const { ws } = base();
    expect(naturalOpening(ws, "ar")).toBe("السلام عليكم يا أحمد، معك ناقة، المساعد الآلي لعزبة الوسم. بتطمن على الحلال اليوم. بشّر، كيف الحلال؟");
  });

  it("gives the model every configured question, the camel names and only four tools", () => {
    const { ws, session } = base();
    const text = buildNaturalInstructions(session, ws, "ar");
    for (const id of ids(session)) expect(text).toContain(`[${id}]`);
    expect(text).toContain("كم لتر حليب تقريباً اليوم؟");
    expect(text).toContain("مزون");
    expect(naturalTools(session, ws).map((entry) => entry.name)).toEqual(["submit_report", "confirm_report", "flag_urgent", "end_call"]);
  });

  it("replays the answers through the engine to its own summary", () => {
    const { ws, session } = base();
    const replayed = replayAnswers(session, ws, NOW, { answers: answers(session) });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.session.step).toBe("report_summary");
    const summary = replayed.session.turns.at(-1)!.text.ar;
    for (const fact of ["مزون للحين تعبانة", "وضحة ما تاكل زين", "الباقي بخير", "20 من الحلال", "العلف: 25 كيس", "الماء: كافٍ", "قارب على النفاد", "قلت: يمكن ثلاثين لتر", "أحفظه، ولا تبي تعدل شي؟"]) expect(summary).toContain(fact);
    const health = Object.fromEntries(replayed.session.draft.camelUpdates.map((update) => [ws.camels.find((camel) => camel.id === update.camelId)?.name, update.health]));
    expect(health).toMatchObject({ مزون: "sick", وضحة: "watch", شيخة: "healthy" });
  });

  it("keeps unknown as unknown and never calls the herd well when nobody said so", () => {
    const { ws, session } = base();
    const given = answers(session);
    given[0] = { question_id: given[0].question_id, value: "unknown" } as (typeof given)[number];
    const replayed = replayAnswers(session, ws, NOW, { answers: given });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.session.draft.camelUpdates.every((update) => update.health !== "healthy")).toBe(true);
    expect(replayed.session.draft.answers.find((entry) => entry.questionId === "herd_health")?.certainty).toBe("unknown");
  });

  it("names the questions still unanswered instead of filling them in", () => {
    const { ws, session } = base();
    const replayed = replayAnswers(session, ws, NOW, { answers: answers(session).slice(0, 3) });
    expect(replayed).toMatchObject({ ok: false, error: "questions_not_answered" });
    if (replayed.ok) return;
    expect(replayed.questions).toContain("water_level");
  });

  it("refuses a value the question doesn't offer", () => {
    const { ws, session } = base();
    const given = answers(session);
    given[4] = { question_id: given[4].question_id, value: "excellent" } as (typeof given)[number];
    expect(replayAnswers(session, ws, NOW, { answers: given })).toMatchObject({ ok: false, error: "values_not_allowed", questions: ["fences_condition"] });
  });

  it("takes a correction as a whole new hand-over, from the start", () => {
    const { ws, session } = base();
    const first = replayAnswers(session, ws, NOW, { answers: answers(session) });
    const corrected = answers(session).map((entry) => (entry.question_id === "feed_level" ? { question_id: "feed_level", number: 30 } : entry));
    const second = replayAnswers(session, ws, NOW, { answers: corrected });
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.session.turns.at(-1)!.text.ar).toContain("العلف: 30 كيس");
    expect(second.session.turns.at(-1)!.text.ar).not.toContain("25 كيس");
  });

  it("asks which camels are missing when the count is short, in the worker's words", () => {
    const { ws, session } = base();
    const given = answers(session).map((entry) => (entry.question_id === "herd_count" ? { question_id: "herd_count", number: 18, missing: "صيتة وطرفة ما شفتهم" } : entry));
    const replayed = replayAnswers(session, ws, NOW, { answers: given });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.session.draft.herdAccountedFor).toBe(false);
    expect(replayed.session.turns.at(-1)!.text.ar).toContain("الحلال غير مكتمل العدد");
  });

  it("keeps an urgent concern in the read-back", () => {
    const { ws, session } = base();
    const replayed = replayAnswers(session, ws, NOW, { answers: answers(session) }, "مزون طايحة ما تقوم");
    expect(replayed.ok && replayed.session.turns.at(-1)!.text.ar).toContain("أمر عاجل ذكرته: مزون طايحة ما تقوم");
  });

  it("saves only through the engine's confirmation after the read-back", () => {
    const { ws, session } = base();
    const replayed = replayAnswers(session, ws, NOW, { answers: answers(session) });
    if (!replayed.ok) throw new Error("replay failed");
    const saved = answer(replayed.session, ws, NOW, { value: "confirm_save" });
    expect(saved.commit).toBeDefined();
    expect(saved.commit!(ws).reports.at(-1)?.answers.length).toBeGreaterThan(5);
  });

  it("turns a fixed line into guidance for the model, but never the summary", () => {
    const line = naturalize({ output: JSON.stringify({ status: "invalid" }), awaitingConfirmation: false, end: null, goodbye: null, sayText: "ما سمعتك زين. أحفظه؟ قل إيه، أو اضغط واحد.", repromptText: "x" }, "ar");
    expect(line.continue).toBe(true);
    expect(line.sayText).toBeUndefined();
    expect(JSON.parse(line.output).say).toContain("أحفظه؟ قل إيه.");
    expect(JSON.parse(line.output).say).not.toContain("اضغط");
    const summary = { output: "{}", awaitingConfirmation: true, end: null, goodbye: null, summaryText: "هذا ملخص التحديث" };
    expect(naturalize(summary, "ar")).toBe(summary);
  });
});
