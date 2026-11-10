import { describe, expect, it } from "vitest";
import { answer, start, type CallSession } from "@/domain/conversation/engine";
import { fromRiyadh } from "@/domain/clock";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { createDemoWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import type { VoiceCallSession } from "../farm-call";
import { decideTool, type ToolCounters, type ToolDecision } from "./decide";
import { REAL_CALL } from "./real-call-transcripts";

const NOW = fromRiyadh(2026, 11, 10, 3, 21);

const QUESTIONS = ["herd_health", "feed_level", "water_level", "custom-vet"];

function call() {
  const ws: Workspace = createDemoWorkspace("ar", "ultimate", NOW);
  Object.assign(ws, { reports: [], calls: [], taskTickets: [], pendingWorkerCalls: [], noAnswerTickets: [] });
  ws.camels = ws.camels.slice(0, 3).map((camel, index) => ({ ...camel, name: ["نورة", "مزون", "شيخة"][index] }));
  ws.settings.customQuestions = [{ id: "custom-vet", text: "جا البيطري اليوم؟", createdAt: NOW.toISOString() }];
  ws.settings.questionPlan = [...QUESTIONS, "herd_count", "fences_condition", "shelter_condition", "medicine_stock"].map((id) => ({ id, enabled: QUESTIONS.includes(id), required: true }));
  const opened = startReportCall(ws, NOW, "manual");
  const live = resolveReportCallAttempt(placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws, NOW, opened.run!.id, true).ws;
  return { ws: live, session: start(live, NOW, "report_call", { reportCallId: opened.run!.id }).session as VoiceCallSession };
}

function driver(first: { ws: Workspace; session: VoiceCallSession }) {
  let session = first.session;
  let counters: ToolCounters = {};
  const spoken: string[] = [];
  return {
    get session() { return session; },
    spoken,
    turn(name: string, args: Record<string, unknown>, heard: string): ToolDecision {
      const decision = decideTool({ session, counters, workspace: first.ws, locale: "ar", name, args, spoke: true, heard, now: NOW });
      counters = { ...counters, ...decision.counters };
      if (decision.kind === "apply") {
        const before = session.turns.length;
        session = answer(decision.session, first.ws, NOW, decision.chosen).session as VoiceCallSession;
        spoken.push(session.turns.slice(before).filter((entry) => entry.speaker === "agent").map((entry) => entry.text.ar).join(" "));
      } else if (decision.kind === "stay") session = decision.session;
      else if (decision.kind === "reply" && decision.result.sayText) spoken.push(decision.result.sayText);
      return decision;
    },
  };
}

const current = (session: CallSession) => session.data.currentQuestionId;

describe("the real call that repeated one question", () => {
  it("has all 29 transcripts", () => expect(REAL_CALL).toHaveLength(29));

  it("can no longer circle, even if the model refuses every single turn", () => {
    const live = driver(call());
    const asked: Record<string, number> = {};
    for (const heard of REAL_CALL) {
      if (live.session.step === "report_summary") break;
      const id = current(live.session) ?? "";
      const decision = live.turn("repeat_or_clarify", { reason: "unclear" }, heard || "الحلال");
      if (!(decision.kind === "reply" && decision.refused === "noise")) asked[id] = (asked[id] ?? 0) + 1;
    }
    expect(live.session.step).toBe("report_summary");
    expect(Math.max(...Object.values(asked))).toBeLessThanOrEqual(3);
  });

  it("asks differently the second time, then moves on", () => {
    const live = driver(call());
    live.turn("repeat_or_clarify", { reason: "unclear" }, "جميع");
    expect(live.spoken[0]).toBe("معليش، ما وضحت لي الإجابة. ممكن تعيدها؟ وش وضع الحلال اليوم؟");
    live.turn("repeat_or_clarify", { reason: "unclear" }, "جميع");
    expect(live.spoken[1]).toContain("قلها لي بكلمة");
    expect(live.spoken[1]).toContain("كلها بخير");
    live.turn("repeat_or_clarify", { reason: "unclear" }, "جميع");
    expect(current(live.session)).toBe("feed_level");
  });

  it("ignores the transcription hint when it is written back as speech", () => {
    const leaks = REAL_CALL.filter((heard) => heard.includes("مكالمة هاتفية") || heard.includes("شعير"));
    expect(leaks).toHaveLength(2);
    for (const heard of leaks) {
      const live = driver(call());
      expect(live.turn("repeat_or_clarify", { reason: "unclear" }, heard)).toMatchObject({ kind: "reply", refused: "noise" });
      expect(live.session.draft.answers).toEqual([]);
    }
  });

  it.each(REAL_CALL.filter((heard) => /(بخير|زين|الحمد لله)/.test(heard) && !heard.includes("،") && !heard.includes("?") && !heard.includes("؟") && !heard.startsWith("أنا") && !heard.startsWith("لو") && !heard.includes("يا ولد")))("advances on the real answer «%s»", (heard) => {
    const live = driver(call());
    live.turn("answer_question", { value: "yes", topic: "herd" }, heard);
    expect(current(live.session)).toBe("feed_level");
  });
});

describe("a whole call on natural answers", () => {
  it("goes through all four questions and reaches the read-back", () => {
    const live = driver(call());
    live.turn("answer_question", { value: "yes", topic: "herd" }, "تمام، الحلال بخير والحمد لله.");
    live.turn("answer_question", { value: "low", topic: "feed" }, "زين بس قرب يخلص");
    live.turn("answer_question", { value: "good", topic: "water" }, "الماء كافي");
    live.turn("answer_question", { text: "لا ما جا", topic: "other" }, "لا ما جا");
    expect(live.session.step).toBe("report_summary");
    const summary = live.spoken.at(-1)!;
    for (const word of ["الحلال كله بخير", "العلف", "الماء", "جا البيطري اليوم؟ لا ما جا"]) expect(summary).toContain(word);
  });

  it("takes «كلهم بخير بس نورة تعبانة» at once: no asking which camel, or whether there is another", () => {
    const first = call();
    const live = driver(first);
    live.turn("answer_question", { value: "no", topic: "herd" }, "كلهم بخير بس نورة تعبانة");
    expect(current(live.session)).toBe("feed_level");
    const [noura, ...rest] = first.ws.camels;
    expect(live.session.draft.camelUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ camelId: noura.id, health: "sick", note: "كلهم بخير بس نورة تعبانة" }),
      ...rest.map((camel) => expect.objectContaining({ camelId: camel.id, health: "healthy" })),
    ]));
    expect(live.session.draft.answers.filter((answer) => answer.questionId === "herd_health")).toHaveLength(1);
  });

  it("records «كلهم تمام بس نورة تعبانة» as نورة even when the model says all are well", () => {
    const first = call();
    const live = driver(first);
    live.turn("answer_question", { value: "yes", topic: "herd" }, "كلهم تمام بس نورة تعبانة");
    expect(live.session.draft.camelUpdates.find((update) => update.camelId === first.ws.camels[0].id)).toMatchObject({ health: "sick" });
  });

  it("takes two named camels at once, then asks only whether there is another", () => {
    const first = call();
    const live = driver(first);
    live.turn("answer_question", { value: "no", topic: "herd" }, "نورة ومزون تعبانات");
    expect(live.session.step).toBe("health_more");
    expect(live.session.draft.camelUpdates.map((update) => update.camelId)).toEqual([first.ws.camels[0].id, first.ws.camels[1].id]);
    live.turn("answer_question", { value: "no", topic: "herd" }, "لا بس");
    expect(current(live.session)).toBe("feed_level");
    expect(live.session.draft.answers.filter((answer) => answer.questionId === "herd_health")).toHaveLength(1);
  });

  it("never takes «زين» for a camel called زينة", () => {
    const first = call();
    first.ws.camels[2] = { ...first.ws.camels[2], name: "زينة" };
    const live = driver(first);
    live.turn("answer_question", { value: "no", topic: "herd" }, "كلهم زين بس وحدة تعبانة");
    expect(live.session.step).toBe("health_pick");
    expect(live.session.draft.camelUpdates).toEqual([]);
  });

  it("asks which camel when the worker didn't name one, and nothing more once they do", () => {
    const first = call();
    const live = driver(first);
    live.turn("answer_question", { value: "no", topic: "herd" }, "كلهم تمام بس وحدة تعبانة");
    expect(live.session.step).toBe("health_pick");
    live.turn("answer_question", { value: `camel:${first.ws.camels[0].id}`, topic: "herd" }, "نورة");
    live.turn("answer_question", { value: "sick", topic: "herd" }, "مسخنة");
    expect(current(live.session)).toBe("feed_level");
  });

  it("does not ask the feed question again after «الحلال بخير والعلف قليل»", () => {
    const live = driver(call());
    live.turn("answer_question", { value: "yes", topic: "herd" }, "الحلال بخير والعلف قليل");
    expect(current(live.session)).toBe("water_level");
    expect(live.session.draft.resourceUpdates).toEqual([expect.objectContaining({ kind: "feed", level: "low" })]);
    // Nothing is left over to keep as a note: the sentence was fully understood.
    expect(live.session.draft.answers.some((answer) => answer.questionId.startsWith("open_note_"))).toBe(false);
    live.turn("answer_question", { value: "good", topic: "water" }, "الماء كافي");
    live.turn("answer_question", { text: "لا ما جا", topic: "other" }, "لا ما جا");
    expect(live.session.step).toBe("report_summary");
    expect(live.spoken.at(-1)).toContain("العلف");
  });

  it("keeps an unclear mention of another topic as a note and still asks that question", () => {
    const live = driver(call());
    live.turn("answer_question", { value: "yes", topic: "herd" }, "الحلال بخير والعلف جابوه أمس");
    expect(current(live.session)).toBe("feed_level");
    expect(live.session.draft.resourceUpdates).toEqual([]);
    expect(live.session.draft.answers.some((answer) => answer.answer === "الحلال بخير والعلف جابوه أمس")).toBe(true);
  });

  it("reads only the feed part of «العلف كافي والماي قليل»", () => {
    const live = driver(call());
    live.turn("answer_question", { value: "yes", topic: "herd" }, "الحلال بخير");
    live.turn("answer_question", { value: "good", topic: "feed" }, "العلف كافي والماي قليل");
    expect(live.session.draft.resourceUpdates).toHaveLength(2);
    expect(live.session.draft.resourceUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "feed", level: "good" }),
      expect.objectContaining({ kind: "water", level: "low" }),
    ]));
    expect(current(live.session)).toBe("custom-vet");
  });

  it("asks again on unclear words instead of guessing", () => {
    const live = driver(call());
    live.turn("answer_question", { value: "good", topic: "feed" }, "كاسييا");
    expect(current(live.session)).toBe("herd_health");
  });
});

describe("the 10 November call that named نورة", () => {
  it("takes «تمام الحمد لله بس دي وحدة تابعنا نورة» at once, without asking which camel", () => {
    const first = call();
    const live = driver(first);
    live.turn("answer_question", { value: "no", topic: "herd" }, "تمام الحمد لله بس دي وحدة تابعنا نورة.");
    expect(live.session.step).toBe("health_more");
    expect(live.session.draft.camelUpdates[0]).toMatchObject({ camelId: first.ws.camels[0].id, health: "sick" });
  });

  it("matches «نورا» to نورة when asked which camel", () => {
    const first = call();
    const live = driver(first);
    live.turn("answer_question", { value: "no", topic: "herd" }, "كلهم تمام بس وحدة تعبانة");
    live.turn("answer_question", { value: `camel:${first.ws.camels[0].id}`, topic: "herd" }, "نورا");
    expect(live.session.step).toBe("health_status");
  });

  it("understands «مسخنة» as sick", () => {
    const first = call();
    const live = driver(first);
    live.turn("answer_question", { value: "no", topic: "herd" }, "كلهم تمام بس وحدة تعبانة");
    live.turn("answer_question", { value: `camel:${first.ws.camels[0].id}`, topic: "herd" }, "نورة");
    live.turn("answer_question", { value: "sick", topic: "herd" }, "مسخنة");
    expect(live.session.draft.camelUpdates[0]).toMatchObject({ camelId: first.ws.camels[0].id, health: "sick" });
  });

  it("does not take the garbled «ماريانا نارا» as no to «فيه غيرها؟»", () => {
    const first = call();
    const live = driver(first);
    live.turn("answer_question", { value: "no", topic: "herd" }, "نورة تعبانة");
    live.turn("answer_question", { value: "no", topic: "herd" }, "ماريانا نارا");
    expect(live.session.step).toBe("health_more");
    live.turn("answer_question", { value: "no", topic: "herd" }, "لا بس");
    expect(current(live.session)).toBe("feed_level");
  });
});
