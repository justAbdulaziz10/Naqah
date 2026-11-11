/**
 * The presentation ranch at any point of a report call, and the Saudi phrasings the demo must understand.
 * Shared by the free backend tests and the paid real-model check.
 */
import { answer, reportSummaryId, start, type AnswerInput, type CallSession } from "@/domain/conversation/engine";
import { fromRiyadh } from "@/domain/clock";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { demoHistory, demoSettings } from "../../../../scripts/demo/presentation-ranch";
import type { VoiceCallSession } from "../farm-call";
import { decideTool } from "./decide";

export const NOW = fromRiyadh(2026, 11, 11, 11, 0);

/** The demo ranch with every standard question on, as these phrasing cases were written for (the demo itself asks five). */
export function fullDemo() {
  const base = demoHistory(demoSettings(NOW), NOW, { endYesterday: true });
  base.settings.customQuestions = base.settings.customQuestions.slice(0, 2);
  base.settings.questionPlan = [];
  return base;
}

export function freshCall() {
  const base = fullDemo();
  const opened = startReportCall(base, NOW, "manual");
  const ws = resolveReportCallAttempt(placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws, NOW, opened.run!.id, true).ws;
  return { ws, session: start(ws, NOW, "report_call", { reportCallId: opened.run!.id }).session as VoiceCallSession };
}

/** Answers every question before `target` plainly, so a case starts there. `target` is a question id prefix or "summary". */
export function at(target: string) {
  const { ws, session } = freshCall();
  let current: CallSession = session;
  for (let guard = 0; guard < 30; guard += 1) {
    if (target === "summary" ? current.step === "report_summary" : current.step === "report_question" && current.data.currentQuestionId?.startsWith(target)) break;
    const input: AnswerInput = current.data.currentQuestionId === "herd_count" ? { text: "20" } : current.inputMode === "text" ? { text: "تمام" } : { value: current.replies[0].value };
    current = answer(current, ws, NOW, input).session;
  }
  return { ws, session: current as VoiceCallSession };
}

/** What the call does with one tool call: "saved", "ended", "ask" (same question again), or what it recorded for the question. */
export function outcome(target: string, name: string, args: unknown, heard: string): string {
  const { ws, session } = at(target);
  const heardSummaryId = session.step === "report_summary" ? reportSummaryId(session, "ar") : undefined;
  const decision = decideTool({ session, counters: {}, workspace: ws, locale: "ar", name, args, spoke: true, heard, heardSummaryId, now: NOW });
  if (decision.kind === "end") return "ended";
  if (decision.kind !== "apply") return "ask";
  const result = answer(decision.session, ws, NOW, decision.chosen);
  if (result.commit) return "saved";
  const id = session.data.currentQuestionId ?? "";
  const said = result.session.draft.answers.filter((entry) => entry.questionId === id).map((entry) => entry.answerText?.ar ?? entry.answer);
  return said.join(" | ") || result.session.step;
}

/** [where, what the worker said, what must happen]. */
export const SAUDI_CASES: [string, string, string][] = [
  ["herd_health", "الحمد لله كلهم طيبين", "الحلال كله بخير"],
  ["herd_health", "زينين ما عليهم شر", "الحلال كله بخير"],
  ["herd_health", "كلها بخير والعلف قليل والموية مليانة", "الحلال كله بخير"],
  ["herd_health", "الحمد لله كلهم بخير بس مزون للحين تعبانة ووضحة ما تاكل زين", "الحلال"],
  ["herd_health", "نورة ومزون تعبانات", "health_more"],
  ["herd_health", "فيه وحدة عرجا", "health_pick"],
  ["herd_health", "والله ما أدري ما شفتهم اليوم", "ما أدري"],
  ["herd_health", "وش تقول؟ ما سمعتك", "ask"],
  ["herd_count", "عشرين", "20 من الحلال"],
  ["herd_count", "تسعطعش", "herd_count_detail"],
  ["herd_count", "مدري ما عديتهم", "ما أدري"],
  ["feed", "خلص العلف", "نفد تقريباً"],
  ["feed", "زين بس قرب يخلص", "قارب على النفاد"],
  ["feed", "كافي الحمد لله", "كافٍ"],
  ["feed", "فيه عشر أكياس", "10 كيس"],
  ["water", "نص الخزان", "متوسط"],
  ["water", "الموية قليلة نبي وايت", "قارب على النفاد"],
  ["fences", "لا والله ما فيه شي", "سليم"],
  ["fences", "فيه جزء مقطوع يبي له تصليح", "يحتاج إصلاح"],
  ["medicine", "باقي بس قليل", "قارب على النفاد"],
  ["cq", "يمكن ثلاثين لتر", "يمكن ثلاثين لتر"],
  ["cq", "مدري", "ما أدري"],
  ["task", "إيه خلصتها", "إيه، خلصت"],
  ["task", "لا باقي، البيطري بيجي بكرة", "باقي"],
  ["summary", "إيه احفظه", "saved"],
  ["summary", "إيه كله صحيح احفظه", "saved"],
  ["summary", "إيه بس العلف غلط", "report_question"],
  ["summary", "لا ما ابي احفظ", "ended"],
];
