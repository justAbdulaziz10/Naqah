/**
 * Saudi phrasings on the presentation ranch: what the backend does with each, given the tool call a correct model makes.
 * Free: no model, no phone. The real model's own choices on these words are checked separately (real-model.live.test.ts).
 */
import { describe, expect, it } from "vitest";
import { answer, reportSummaryId, start, type CallSession } from "@/domain/conversation/engine";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import type { Workspace } from "@/domain/types";
import type { VoiceCallSession } from "../farm-call";
import { decideTool, spokenFrom, type ToolCounters } from "./decide";
import { at, freshCall, fullDemo, NOW } from "./saudi-cases";

function live(first: { ws: Workspace; session: VoiceCallSession }) {
  let session = first.session;
  let counters: ToolCounters = {};
  let committed = false;
  const said: string[] = [spokenFrom(session, 0, first.ws, "ar").join(" ")];
  return {
    get session() { return session; },
    get committed() { return committed; },
    said,
    turn(heard: string, name: string, args: Record<string, unknown>) {
      const heardSummaryId = session.step === "report_summary" ? reportSummaryId(session, "ar") : undefined;
      const decision = decideTool({ session, counters, workspace: first.ws, locale: "ar", name, args, spoke: true, heard, heardSummaryId, now: NOW });
      counters = { ...counters, ...decision.counters };
      if (decision.kind === "apply") {
        const before = decision.session.turns.length;
        const result = answer(decision.session, first.ws, NOW, decision.chosen);
        session = result.session as VoiceCallSession;
        committed ||= Boolean(result.commit);
        said.push(decision.prefix + spokenFrom(session, before, first.ws, "ar").join(" "));
      } else if (decision.kind === "stay") {
        session = decision.session;
        said.push(decision.result.sayText ?? "");
      } else if (decision.kind === "reply") said.push(decision.result.sayText ?? decision.result.summaryText ?? "");
      return decision;
    },
  };
}

const recorded = (session: CallSession, id: string) => session.draft.answers.filter((entry) => entry.questionId.startsWith(id)).map((entry) => entry.answerText?.ar ?? entry.answer);

describe("Saudi answers that must be taken at once", () => {
  it.each([
    ["herd_health", "الحمد لله كلهم طيبين", { value: "yes", topic: "herd" }, "الحلال كله بخير"],
    ["herd_health", "زينين ما عليهم شر", { value: "yes", topic: "herd" }, "الحلال كله بخير"],
    ["herd_health", "والله ما أدري ما شفتهم اليوم", { value: "unknown", topic: "herd" }, "ما أدري"],
    ["herd_count", "تسعطعش", { text: "19", topic: "herd" }, null],
    ["herd_count", "عشرين الا وحدة", { text: "19", topic: "herd" }, null],
    ["herd_count", "ثمنطعش، ثنتين ما شفتهم", { text: "18", topic: "herd" }, null],
    ["herd_count", "مدري ما عديتهم", { value: "unknown", topic: "herd" }, "ما أدري"],
    ["feed", "خلص العلف", { value: "critical", topic: "feed" }, "نفد تقريباً"],
    ["feed", "زين بس قرب يخلص", { value: "low", topic: "feed" }, "قارب على النفاد"],
    ["feed", "باقي شوي يكفي يومين", { value: "low", topic: "feed" }, "قارب على النفاد"],
    ["feed", "فيه عشر أكياس", { text: "10", topic: "feed" }, "10 كيس"],
    ["water", "نص الخزان", { value: "medium", topic: "water" }, "متوسط"],
    ["water", "الموية قليلة نبي وايت", { value: "low", topic: "water" }, "قارب على النفاد"],
    ["fences", "لا والله ما فيه شي", { value: "good", topic: "fences" }, "سليم"],
    ["fences", "يبي له تصليح", { value: "low", topic: "fences" }, "يحتاج إصلاح"],
    ["medicine", "باقي بس قليل", { value: "low", topic: "medicine" }, "قارب على النفاد"],
    ["cq", "مدري", { value: "unknown", topic: "other" }, "ما أدري"],
    ["task", "تمت", { value: "yes", topic: "task" }, "إيه، خلصت"],
    ["task", "لا باقي، البيطري بيجي بكرة", { value: "no", topic: "task" }, "باقي"],
  ] as const)("[%s] «%s»", (target, heard, args, expected) => {
    const call = live(at(target));
    const asked = call.session.data.currentQuestionId!;
    const decision = call.turn(heard, "answer_question", args);
    expect(decision.kind).toBe("apply");
    expect([call.session.step, call.session.data.currentQuestionId]).not.toEqual(["report_question", asked]);
    if (expected) expect(recorded(call.session, asked)).toEqual([expected]);
  });

  it("asks which count is missing, not the count again, after «عشرين الا وحدة»", () => {
    const call = live(at("herd_count"));
    call.turn("عشرين الا وحدة", "answer_question", { text: "19", topic: "herd" });
    expect(call.said.at(-1)).toContain("أقل من 20");
  });
});

describe("one reply that answers several questions", () => {
  it("records feed and water from the herd answer and never asks them", () => {
    const call = live(at("herd_health"));
    call.turn("كلها بخير والعلف قليل والموية مليانة", "answer_question", { value: "yes", topic: "herd" });
    expect(recorded(call.session, "feed_level")).toEqual(["قارب على النفاد"]);
    expect(recorded(call.session, "water_level")).toEqual(["كافٍ"]);
    call.turn("عشرين", "answer_question", { text: "20", topic: "herd" });
    expect(call.session.data.currentQuestionId).toBe("fences_condition");
  });

  it("keeps each named camel in the worker's own words, and the rest well", () => {
    const call = live(at("herd_health"));
    call.turn("الحمد لله كلهم بخير بس مزون للحين تعبانة ووضحة ما تاكل زين", "answer_question", { value: "no", topic: "herd" });
    expect(call.session.data.currentQuestionId).toBe("herd_count");
    expect(call.said.at(-1)).toBe("سلامتهم. كم عدد الحلال؟");
    const [line] = recorded(call.session, "herd_health");
    expect(line).toContain("مزون للحين تعبانة");
    expect(line).toContain("وضحة ما تاكل زين");
    expect(line).toContain("الباقي بخير");
    expect(line).not.toContain("الحمد لله كلهم");
    expect(call.session.draft.camelUpdates.map((update) => update.note).filter(Boolean).sort()).toEqual(["مزون للحين تعبانة", "وضحة ما تاكل زين"]);
  });

  it("shares the ending between two names: «نورة ومزون تعبانات»", () => {
    const call = live(at("herd_health"));
    call.turn("نورة ومزون تعبانات", "answer_question", { value: "no", topic: "herd" });
    expect(call.said.at(-1)).toBe("سلامتهم. فيه غيرها؟");
    call.turn("لا بس", "answer_question", { value: "no", topic: "herd" });
    const [after] = recorded(call.session, "herd_health");
    expect(after).toContain("نورة تعبانات");
    expect(after).toContain("مزون تعبانات");
  });
});

describe("unclear, ambiguous and refused replies", () => {
  it("asks again plainly, then in one word, then moves on as unknown", () => {
    const call = live(at("herd_health"));
    call.turn("يعني ماشي الحال", "repeat_or_clarify", { reason: "unclear" });
    expect(call.said.at(-1)).toBe("معليش، ما فهمت جوابك زين. كيف الحلال اليوم؟");
    call.turn("يعني", "repeat_or_clarify", { reason: "unclear" });
    expect(call.said.at(-1)).toContain("قلها لي بكلمة");
    call.turn("يعني", "repeat_or_clarify", { reason: "unclear" });
    expect(call.session.data.currentQuestionId).toBe("herd_count");
  });

  it("refuses a level the words contradict", () => {
    const call = live(at("feed"));
    const decision = call.turn("خلص العلف", "answer_question", { value: "good", topic: "feed" });
    expect(decision.kind).toBe("reply");
    expect(call.session.data.currentQuestionId).toBe("feed_level");
  });

  it("refuses a count that was never said", () => {
    const call = live(at("herd_count"));
    expect(call.turn("كثيرة", "answer_question", { text: "20", topic: "herd" }).kind).toBe("reply");
  });
});

describe("read-back, correction and confirmation", () => {
  it.each(["إيه احفظ", "تمام", "أيوه صح", "إيه كله صحيح احفظه", "صح", "اوكي", "إي نعم"])("saves on «%s»", (heard) => {
    const call = live(at("summary"));
    call.turn(heard, "confirm_report", { confirmed: true });
    expect(call.committed).toBe(true);
  });

  it.each(["إيه بس العلف غلط", "زين؟", "وش قلت"])("does not save on «%s»", (heard) => {
    const call = live(at("summary"));
    call.turn(heard, "confirm_report", { confirmed: true });
    expect(call.committed).toBe(false);
  });

  it("corrects one item, re-reads the whole summary, then saves", () => {
    const call = live(at("summary"));
    call.turn("لا العلف غلط", "correct_report", { item_id: "feed_level" });
    expect(call.said.at(-1)).toBe("طيب، نعدلها. كم باقي من العلف عندكم؟");
    call.turn("ثلاثين كيس", "answer_question", { text: "30", topic: "feed" });
    expect(call.said.at(-1)).toMatch(/هذا ملخص التحديث: .*العلف: 30 كيس/);
    call.turn("إيه احفظه", "confirm_report", { confirmed: true });
    expect(call.committed).toBe(true);
  });

  it("ends without saving when the worker asks", () => {
    const call = live(at("summary"));
    expect(call.turn("لا ما ابي احفظ", "end_call", { reason: "worker_ended" }).kind).toBe("end");
    expect(call.committed).toBe(false);
  });
});

describe("the presentation call, start to finish", () => {
  it("is short, acknowledges each answer and reads every fact back once", () => {
    const call = live(freshCall());
    call.turn("الحمد لله كلهم بخير بس مزون للحين تعبانة ووضحة ما تاكل زين", "answer_question", { value: "no", topic: "herd" });
    call.turn("عشرين، كاملات", "answer_question", { text: "20", topic: "herd" });
    call.turn("العلف يمكن خمسة وعشرين كيس، والموية الحمد لله مليانة", "answer_question", { text: "25", topic: "feed" });
    call.turn("الشبك صلحناه أمس، سليم", "answer_question", { value: "good", topic: "fences" });
    call.turn("زينة", "answer_question", { value: "good", topic: "shelter" });
    call.turn("الدوا باقي بس قليل", "answer_question", { value: "low", topic: "medicine" });
    call.turn("يمكن ثلاثين لتر", "answer_question", { text: "يمكن ثلاثين لتر", topic: "other" });
    call.turn("لا ما جا أحد", "answer_question", { text: "لا ما جا أحد", topic: "other" });
    call.turn("إيه عزلتها وكلمت البيطري", "answer_question", { value: "yes", topic: "task" });
    expect(call.session.step).toBe("report_summary");
    // Water was answered with feed, so it was never asked.
    expect(call.said.some((line) => line.includes("كيف الماء"))).toBe(false);
    const summary = call.said.at(-1)!;
    for (const fact of ["مزون للحين تعبانة", "وضحة ما تاكل زين", "الباقي بخير", "العلف: 25 كيس", "الماء: كافٍ", "قارب على النفاد", "قلت: يمكن ثلاثين لتر", "أحفظه، ولا تبي تعدل شي؟"]) expect(summary).toContain(fact);
    call.turn("إيه احفظه", "confirm_report", { confirmed: true });
    expect(call.committed).toBe(true);
    expect(call.said.length).toBe(11);
  });
});

describe("the opening on a live call", () => {
  function opening() {
    const ws = fullDemo();
    const opened = startReportCall(ws, NOW, "manual");
    const live0 = resolveReportCallAttempt(placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws, NOW, opened.run!.id, true).ws;
    live0.settings.reportMode = "guided";
    return { ws: live0, session: start(live0, NOW, "report_call", { reportCallId: opened.run!.id, modesAvailable: true, greetFirst: true }).session as VoiceCallSession };
  }

  it("greets by name and ranch, and waits for «جاهز؟»", () => {
    const call = live(opening());
    expect(call.said[0]).toBe("السلام عليكم يا أحمد، معك ناقة، المساعد الآلي لعزبة الوسم. بتطمن على الحلال اليوم، جاهز؟");
    expect(call.session.step).toBe("report_ready");
  });

  it.each(["إيه جاهز", "وعليكم السلام، تفضل", "هلا والله", "يلا", "نعم"])("starts the report on «%s»", (heard) => {
    const call = live(opening());
    call.turn(heard, "answer_question", { value: "ready", topic: "herd" });
    expect(call.said.at(-1)).toBe("كيف الحلال اليوم؟");
  });

  it.each(["ألو", "الو؟", "مين معي", ""])("says the greeting again on «%s», then goes ahead", (heard) => {
    const call = live(opening());
    call.turn(heard, "repeat_or_clarify", { reason: "noise" });
    expect(call.said.at(-1)).toBe("هلا. السلام عليكم يا أحمد، معك ناقة، المساعد الآلي لعزبة الوسم. بتطمن على الحلال اليوم، جاهز؟");
    call.turn("ألو", "repeat_or_clarify", { reason: "noise" });
    call.turn("ألو", "repeat_or_clarify", { reason: "noise" });
    expect(call.said.at(-1)).toBe("كيف الحلال اليوم؟");
  });

  it("ends politely, saving nothing, when the worker is busy", () => {
    const call = live(opening());
    call.turn("والله مشغول الحين", "end_call", { reason: "worker_ended" });
    expect(call.session.done).toBe(true);
    expect(call.said.at(-1)).toBe("ما عليه، يعطيك العافية يا أحمد. مع السلامة.");
  });
});

describe("when the phone transcript misses what the model heard", () => {
  it("asks once, then takes the same count heard a second time", () => {
    const call = live(at("herd_count"));
    expect(call.turn("عشرييين", "answer_question", { text: "20", topic: "herd" }).kind).toBe("reply");
    expect(call.turn("هم عشرييين", "answer_question", { text: "20", topic: "herd" }).kind).toBe("apply");
    expect(recorded(call.session, "herd_count")).toEqual(["20 من الحلال"]);
  });

  it("does not take a different count the second time", () => {
    const call = live(at("herd_count"));
    call.turn("عشرييين", "answer_question", { text: "20", topic: "herd" });
    expect(call.turn("عشرييين", "answer_question", { text: "21", topic: "herd" }).kind).toBe("reply");
  });

  it("does not take the model's count over a different number in the words", () => {
    const call = live(at("herd_count"));
    call.turn("عشرة", "answer_question", { text: "20", topic: "herd" });
    expect(call.turn("عشرة", "answer_question", { text: "20", topic: "herd" }).kind).toBe("reply");
  });

  it("never closes a task on the model's word alone", () => {
    const call = live(at("task"));
    call.turn("ممم", "answer_question", { value: "yes", topic: "task" });
    expect(call.turn("ممم", "answer_question", { value: "yes", topic: "task" }).kind).toBe("reply");
  });
});
