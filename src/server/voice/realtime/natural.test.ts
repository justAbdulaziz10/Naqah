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

/** What a natural conversation hands over after the worker's free answers on the demo ranch's short call. */
function answers(session: ReturnType<typeof base>["session"]) {
  return ids(session).map((id) => {
    if (id === "herd_health") return { question_id: id, value: "no", rest_well: true, camels: [{ name: "مزون", status: "sick", note: "مزون للحين تعبانة" }, { name: "وضحة", status: "watch", note: "وضحة ما تاكل زين" }] };
    if (id === "feed_level") return { question_id: id, number: 25 };
    if (id === "water_level") return { question_id: id, value: "good" };
    if (id === "fences_condition") return { question_id: id, value: "good" };
    if (id.startsWith("task_")) return { question_id: id, value: "yes" };
    return { question_id: id, text: "الماسورة تسرب شوي" };
  });
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
    for (const asked of ["بشّر، كيف الحلال اليوم؟", "فيه ناقة تعبانة أو تحتاج متابعة؟", "كم باقي من العلف عندكم؟", "كيف وضع الماي؟", "فيه شي خربان أو يحتاج تصليح؟", "فيه شي ثاني تبي تبلغ عنه؟"]) expect(text).toContain(asked);
    // The demo's short call: the older questions are switched off for this ranch only.
    for (const dropped of ["كم لتر حليب", "فيه أحد زار", "[herd_count]", "[shelter_condition]", "[medicine_stock]"]) expect(text).not.toContain(dropped);
    expect(ids(session)).toHaveLength(6);
    expect(text.indexOf("«فيه شي ثاني تبي تبلغ عنه؟»")).toBeGreaterThan(text.indexOf("[task_"));
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
    for (const fact of ["مزون للحين تعبانة", "وضحة ما تاكل زين", "الباقي بخير", "العلف: 25 كيس", "الماء: كافٍ", "الشبك والسياج: سليم", "فيه شي ثاني تبي تبلغ عنه، قلت: الماسورة تسرب شوي", "أحفظه، ولا تبي تعدل شي؟"]) expect(summary).toContain(fact);
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
    expect(replayed.questions).toContain("fences_condition");
  });

  it("refuses a value the question doesn't offer", () => {
    const { ws, session } = base();
    const given = answers(session);
    const at = given.findIndex((entry) => entry.question_id === "fences_condition");
    given[at] = { question_id: "fences_condition", value: "excellent" } as (typeof given)[number];
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

  it.each([
    ["«باقي 25 كيس»", { number: 25, unit: "كيس" }, { ar: "25 كيس", en: "25 bags" }, { level: "unknown", quantity: "25 كيس", certainty: "approximate" }],
    ["«عندنا 10 بالات»", { number: 10, unit: "بالات" }, { ar: "10 بالات", en: "10 bales" }, { level: "unknown", quantity: "10 بالات", certainty: "approximate" }],
    ["«باقي شوي»", { value: "low" }, { ar: "قارب على النفاد", en: "Running low" }, { level: "low", quantity: null, certainty: "reported" }],
    ["«ما أدري»", { value: "unknown" }, { ar: "غير معروف", en: "Unknown" }, { level: "unknown", quantity: null, certainty: "unknown" }],
    ["a number with a made-up unit", { number: 7, unit: "<b>x</b>" }, { ar: "7 كيس", en: "7 bags" }, { level: "unknown", quantity: "7 كيس", certainty: "approximate" }],
  ])("keeps the feed amount as said: %s", (_label, feed, answerText, resource) => {
    const { ws, session } = base();
    const given = answers(session).map((entry) => (entry.question_id === "feed_level" ? { question_id: "feed_level", ...feed } : entry));
    const replayed = replayAnswers(session, ws, NOW, { answers: given });
    expect(replayed.ok).toBe(true);
    const draft = replayed.ok ? replayed.session.draft : null;
    const saved = draft!.answers.find((entry) => entry.questionId === "feed_level")!;
    expect(saved.question.ar).toBe("كم باقي من العلف عندكم؟");
    expect(saved.answerText).toEqual(answerText);
    expect(draft!.resourceUpdates.find((update) => update.kind === "feed")).toMatchObject(resource);
  });

  it("tells the model to keep the worker's unit and never invent an amount", () => {
    const { ws, session } = base();
    const text = buildNaturalInstructions(session, ws, "ar");
    expect(text).toContain("«كم باقي من العلف عندكم؟»");
    expect(text).toContain("لا تخترع رقم ولا وحدة ما قالها");
    const submit = naturalTools(session, ws).find((entry) => JSON.stringify(entry).includes("submit_report"));
    expect(JSON.stringify(submit)).toContain('"unit":{"type":"string","maxLength":20}');
  });
});
