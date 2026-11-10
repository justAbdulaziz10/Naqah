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
    expect(live.spoken[0]).toBe("معليش، ما فهمت جوابك زين. كيف الحلال اليوم؟");
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

  it("takes «كلهم بخير بس نورة تعبانة» at once: no asking which camel", () => {
    const first = call();
    const live = driver(first);
    live.turn("answer_question", { value: "no", topic: "herd" }, "كلهم بخير بس نورة تعبانة");
    expect(live.session.step).toBe("health_more");
    expect(live.session.draft.camelUpdates).toEqual([expect.objectContaining({ camelId: first.ws.camels[0].id, health: "sick", note: "كلهم بخير بس نورة تعبانة" })]);
  });

  it("asks which camel when the worker didn't name one", () => {
    const live = driver(call());
    live.turn("answer_question", { value: "no", topic: "herd" }, "كلهم تمام بس وحدة تعبانة");
    expect(live.session.step).toBe("health_pick");
  });

  it("asks again on unclear words instead of guessing", () => {
    const live = driver(call());
    live.turn("answer_question", { value: "good", topic: "feed" }, "كاسييا");
    expect(current(live.session)).toBe("herd_health");
  });
});
