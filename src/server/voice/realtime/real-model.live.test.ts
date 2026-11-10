/**
 * PAID: asks the real OpenAI model which tool it would call for the 37 test cases, in text mode, with the same
 * instructions and tools as a phone call. Skipped unless NAQAH_REAL_MODEL=1 and OPENAI_API_KEY are set.
 * Stops itself before NAQAH_REAL_MODEL_BUDGET dollars. NAQAH_REAL_MODEL_LOG is where each result is appended.
 */
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error The ws package ships without types here.
import WebSocket from "ws";
import { spokenFrom } from "./decide";
import { buildInstructions } from "./instructions";
import { callAt, finalOutcome, MODEL_CASES, type ModelCase } from "./real-model-cases";
import { promptFor, REALTIME_TOOLS } from "./tools";

const MODEL = "gpt-realtime-2.1";
const BUDGET = Number(process.env.NAQAH_REAL_MODEL_BUDGET ?? "0.45");
const total = { input: 0, cached: 0, output: 0 };
const spent = () => (total.input * 4 + total.cached * 0.4 + total.output * 24) / 1_000_000;

function decide(step: ModelCase["step"], heard: string): Promise<ModelCase["raw"] | null> {
  const { ws, session } = callAt(step);
  const prompt = promptFor(session, spokenFrom(session, Math.max(0, session.turns.length - 1), ws, "ar"), ws, "ar");
  const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  let made: ModelCase["raw"] | null = null;
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
      if (event.type === "response.function_call_arguments.done") made = { name: event.name, args: JSON.parse(event.arguments) };
      if (event.type === "response.done") {
        clearTimeout(timer);
        socket.close();
        const usage = event.response?.usage ?? {};
        const cached = usage.input_token_details?.cached_tokens ?? 0;
        total.input += (usage.input_tokens ?? 0) - cached;
        total.cached += cached;
        total.output += usage.output_tokens ?? 0;
        resolve(made);
      }
    });
  });
}

describe.runIf(process.env.NAQAH_REAL_MODEL === "1" && Boolean(process.env.OPENAI_API_KEY))("the real model on the 37 cases", () => {
  it("records raw and backend decisions", async () => {
    let finished = 0;
    for (const item of MODEL_CASES) {
      if (spent() >= BUDGET) break;
      const raw = await decide(item.step, item.heard);
      finished += 1;
      if (process.env.NAQAH_REAL_MODEL_LOG) {
        appendFileSync(process.env.NAQAH_REAL_MODEL_LOG, JSON.stringify({ heard: item.heard, step: item.step, expect: item.expect, raw, final: raw ? finalOutcome(item.step, raw, item.heard) : "ask", total, spent: spent() }) + "\n");
      }
    }
    expect(finished).toBe(MODEL_CASES.length);
  }, 420_000);
});
