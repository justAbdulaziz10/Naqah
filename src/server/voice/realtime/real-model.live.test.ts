/**
 * PAID: asks the real OpenAI model which tool it would call for real transcripts, in text mode, with the
 * same instructions and tools as a phone call. Skipped unless NAQAH_REAL_MODEL=1 and OPENAI_API_KEY are set.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error The ws package ships without types here.
import WebSocket from "ws";
import { answer, start, type CallSession } from "@/domain/conversation/engine";
import { fromRiyadh } from "@/domain/clock";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { createDemoWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import { spokenFrom } from "./decide";
import { buildInstructions } from "./instructions";
import { promptFor, REALTIME_TOOLS } from "./tools";
import { REAL_CALL } from "./real-call-transcripts";

const NOW = fromRiyadh(2026, 11, 10, 3, 21);
const MODEL = "gpt-realtime-2.1";

function callAt(step: "herd" | "feed"): { ws: Workspace; session: CallSession } {
  const ws = createDemoWorkspace("ar", "ultimate", NOW);
  Object.assign(ws, { reports: [], calls: [], taskTickets: [], pendingWorkerCalls: [], noAnswerTickets: [] });
  ws.camels = ws.camels.slice(0, 3).map((camel, index) => ({ ...camel, name: ["نورة", "مزون", "شيخة"][index] }));
  const opened = startReportCall(ws, NOW, "manual");
  const live = resolveReportCallAttempt(placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws, NOW, opened.run!.id, true).ws;
  let session = start(live, NOW, "report_call", { reportCallId: opened.run!.id }).session;
  if (step === "feed") session = answer(session, live, NOW, { value: "yes" }).session;
  return { ws: live, session };
}

function decision(step: "herd" | "feed", heard: string): Promise<{ name: string; args: Record<string, unknown> }> {
  const { ws, session } = callAt(step);
  const prompt = promptFor(session, spokenFrom(session, Math.max(0, session.turns.length - 1), ws, "ar"), ws, "ar");
  const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("timed out")); }, 30_000);
    const send = (message: object) => socket.send(JSON.stringify(message));
    socket.on("open", () => send({
      type: "session.update",
      session: { type: "realtime", model: MODEL, output_modalities: ["text"], instructions: buildInstructions("ar", { worker: "أحمد", owner: "مختبر" }, prompt), tools: REALTIME_TOOLS, tool_choice: "required", audio: { input: { turn_detection: null } } },
    }));
    socket.on("error", (error: Error) => { clearTimeout(timer); reject(error); });
    socket.on("message", (raw: Buffer) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "error") { clearTimeout(timer); socket.close(); reject(new Error(event.error?.message ?? "provider error")); }
      if (event.type === "session.updated") {
        send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: heard }] } });
        send({ type: "response.create" });
      }
      if (event.type === "response.function_call_arguments.done") {
        clearTimeout(timer);
        socket.close();
        resolve({ name: event.name, args: JSON.parse(event.arguments) });
      }
    });
  });
}

const CASES: { step: "herd" | "feed"; heard: string; tool: string; value?: string }[] = [
  { step: "herd", heard: "الحلال بخير.", tool: "answer_question", value: "yes" },
  { step: "herd", heard: "الحمد لله", tool: "answer_question", value: "yes" },
  { step: "herd", heard: "تمام، الحلال بخير والحمد لله.", tool: "answer_question", value: "yes" },
  { step: "herd", heard: "كلهم بخير بس نورة تعبانة", tool: "answer_question", value: "no" },
  { step: "herd", heard: "تمام الحمد لله بس في واحدة تعبانة.", tool: "answer_question", value: "no" },
  { step: "herd", heard: "كلهم تمام، ألا في وحدة تعبانه.", tool: "answer_question", value: "no" },
  { step: "feed", heard: "زين بس قرب يخلص", tool: "answer_question", value: "low" },
  { step: "feed", heard: "كافي الحمد لله", tool: "answer_question", value: "good" },
  { step: "feed", heard: "خلص العلف", tool: "answer_question", value: "critical" },
  { step: "herd", heard: "وش تقول؟ ما سمعت", tool: "repeat_or_clarify" },
  { step: "herd", heard: "أقدراشgba", tool: "repeat_or_clarify" },
  { step: "feed", heard: "كاسييا", tool: "repeat_or_clarify" },
];

describe.runIf(process.env.NAQAH_REAL_MODEL === "1" && Boolean(process.env.OPENAI_API_KEY))("the real model's tool decisions", () => {
  it.each(CASES)("«$heard» → $tool $value", async ({ step, heard, tool, value }) => {
    const made = await decision(step, heard);
    console.info(JSON.stringify({ heard, name: made.name, args: made.args }));
    expect(made.name).toBe(tool);
    if (value) expect(made.args.value).toBe(value);
  }, 40_000);

  it("reports what it would do with all 29 real-call transcripts", async () => {
    const made = [];
    for (const heard of REAL_CALL.filter(Boolean)) made.push({ heard, ...(await decision("herd", heard)) });
    console.info(JSON.stringify(made));
    const clear = made.filter((row) => /(بخير|الحمد لله|زين)/.test(row.heard));
    expect(clear.filter((row) => row.name === "answer_question").length / clear.length).toBeGreaterThanOrEqual(0.8);
  }, 300_000);
});
