/**
 * The 37 Arabic test cases. `raw` is what the real model chose in the first paid run; `expect` is what the call should do.
 * That run asked the feed cases at the wrong question, so their recorded `topic` is corrected to feed here.
 */
import { answer, start, type CallSession } from "@/domain/conversation/engine";
import { fromRiyadh } from "@/domain/clock";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { createDemoWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import type { VoiceCallSession } from "../farm-call";
import { decideTool } from "./decide";

export const NOW = fromRiyadh(2026, 11, 10, 3, 21);

export type ModelCase = { step: "herd" | "feed"; heard: string; expect: string; raw: { name: string; args: Record<string, unknown> } };

export const MODEL_CASES: ModelCase[] = [
  {"step": "herd", "heard": "الحلال بخير.", "expect": "yes", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "الحمد لله", "expect": "yes", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "تمام، الحلال بخير والحمد لله.", "expect": "yes", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "كلهم بخير بس نورة تعبانة", "expect": "no", "raw": {"name": "answer_question", "args": {"text": "كلهم بخير بس نورة تعبانة", "topic": "herd"}}},
  {"step": "herd", "heard": "تمام الحمد لله بس في واحدة تعبانة.", "expect": "no", "raw": {"name": "answer_question", "args": {"value": "no", "topic": "herd"}}},
  {"step": "herd", "heard": "كلهم تمام، ألا في وحدة تعبانه.", "expect": "no", "raw": {"name": "answer_question", "args": {"topic": "herd", "value": "no"}}},
  {"step": "feed", "heard": "زين بس قرب يخلص", "expect": "low", "raw": {"name": "answer_question", "args": {"text": "زين بس قرب يخلص", "topic": "feed"}}},
  {"step": "feed", "heard": "كافي الحمد لله", "expect": "good", "raw": {"name": "answer_question", "args": {"topic": "feed", "text": "كافي الحمد لله"}}},
  {"step": "feed", "heard": "خلص العلف", "expect": "critical", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "وش تقول؟ ما سمعت", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "asked_to_repeat"}}},
  {"step": "herd", "heard": "أقدراشgba", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "noise"}}},
  {"step": "feed", "heard": "كاسييا", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحلال بخير.", "expect": "yes", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "الحلال، ناقة، النوق، علف، شعير، ماء، خزان، وايت، شبك، بيطري، زين، بخير، الحمد لله، كافي، خلص، باقي، إيه، صح، تمام، احفظ، ما أدري، شيخة، مزون، نورة.", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحلال ناقة.", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحمد لله", "expect": "yes", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "إيه ما أدري", "expect": "unknown", "raw": {"name": "answer_question", "args": {"value": "unknown", "topic": "herd"}}},
  {"step": "herd", "heard": "الحمد لله", "expect": "yes", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحمد لله", "expect": "yes", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحمد لله", "expect": "yes", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "بالعافية لكم", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحلال", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحلال بخير?", "expect": "yes", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحلال زين، الحمد لله.", "expect": "yes", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "الحمد لله", "expect": "yes", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "زين يا ولد.", "expect": "yes", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "أنا بخير الحمد لله.", "expect": "ambiguous", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحلال", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحمد لله", "expect": "yes", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "الحمد لله.", "expect": "yes", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "الحلال زين؟", "expect": "ambiguous", "raw": {"name": "repeat_or_clarify", "args": {"reason": "asked_to_repeat"}}},
  {"step": "herd", "heard": "مكالمة هاتفية عن عزبة إبل.", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "لو بخير", "expect": "ambiguous", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "جميع", "expect": "ask", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "الحلال", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
  {"step": "herd", "heard": "تمام، الحلال بخير والحمد لله.", "expect": "yes", "raw": {"name": "answer_question", "args": {"value": "yes", "topic": "herd"}}},
  {"step": "herd", "heard": "الحلال.", "expect": "ask", "raw": {"name": "repeat_or_clarify", "args": {"reason": "unclear"}}},
];

const QUESTIONS = ["herd_health", "feed_level", "water_level"];

export function callAt(step: ModelCase["step"]): { ws: Workspace; session: CallSession } {
  const ws = createDemoWorkspace("ar", "ultimate", NOW);
  Object.assign(ws, { reports: [], calls: [], taskTickets: [], pendingWorkerCalls: [], noAnswerTickets: [] });
  ws.camels = ws.camels.slice(0, 3).map((camel, index) => ({ ...camel, name: ["نورة", "مزون", "شيخة"][index] }));
  ws.settings.customQuestions = [];
  ws.settings.questionPlan = [...QUESTIONS, "herd_count", "fences_condition", "shelter_condition", "medicine_stock"].map((id) => ({ id, enabled: QUESTIONS.includes(id), required: true }));
  const opened = startReportCall(ws, NOW, "manual");
  const live = resolveReportCallAttempt(placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws, NOW, opened.run!.id, true).ws;
  let session = start(live, NOW, "report_call", { reportCallId: opened.run!.id }).session;
  if (step === "feed") session = answer(session, live, NOW, { value: "yes" }).session;
  return { ws: live, session };
}

/** What the backend does with one model decision: the reply it records, or "ask". */
export function finalOutcome(step: ModelCase["step"], raw: ModelCase["raw"], heard: string): string {
  const { ws, session } = callAt(step);
  const decision = decideTool({ session: session as VoiceCallSession, counters: {}, workspace: ws, locale: "ar", name: raw.name, args: raw.args, spoke: true, heard, now: NOW });
  return decision.kind === "apply" ? String(decision.chosen.value ?? decision.chosen.text ?? "ask") : "ask";
}
