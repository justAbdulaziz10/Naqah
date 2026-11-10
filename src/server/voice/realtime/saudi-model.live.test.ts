/**
 * PAID: asks the real model which tool it calls for each Saudi phrasing, at its real place in the presentation call,
 * in text mode with the phone call's instructions and tools. Then the backend decides as on a call.
 * Skipped unless NAQAH_REAL_MODEL=1 and OPENAI_API_KEY are set. Stops before NAQAH_REAL_MODEL_BUDGET dollars (default 1).
 * NAQAH_REAL_MODEL_LOG receives one JSON line per case; no key or audio is written.
 */
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error The ws package ships without types here.
import WebSocket from "ws";
import { spokenFrom } from "./decide";
import { buildInstructions } from "./instructions";
import { at, outcome, SAUDI_CASES } from "./saudi-cases";
import { promptFor, REALTIME_TOOLS } from "./tools";

const MODEL = "gpt-realtime-2.1";
const BUDGET = Number(process.env.NAQAH_REAL_MODEL_BUDGET ?? "1");
const total = { input: 0, cached: 0, output: 0 };
const spent = () => (total.input * 4 + total.cached * 0.4 + total.output * 24) / 1_000_000;

function choose(target: string, heard: string): Promise<{ name: string; args: Record<string, unknown> } | null> {
  const { ws, session } = at(target);
  const prompt = promptFor(session, spokenFrom(session, Math.max(0, session.turns.length - 1), ws, "ar"), ws, "ar");
  const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  let made: { name: string; args: Record<string, unknown> } | null = null;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("timed out")); }, 30_000);
    const send = (message: object) => socket.send(JSON.stringify(message));
    socket.on("open", () => send({
      type: "session.update",
      session: { type: "realtime", model: MODEL, output_modalities: ["text"], instructions: buildInstructions("ar", { worker: ws.settings.worker.name, owner: ws.settings.owner.name }, prompt), tools: REALTIME_TOOLS, tool_choice: "required", reasoning: { effort: "minimal" }, audio: { input: { turn_detection: null } } },
    }));
    socket.on("error", (error: Error) => { clearTimeout(timer); reject(error); });
    socket.on("message", (raw: Buffer) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "error") { clearTimeout(timer); socket.close(); reject(new Error(event.error?.code ?? "provider error")); }
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

describe.runIf(process.env.NAQAH_REAL_MODEL === "1" && Boolean(process.env.OPENAI_API_KEY))("the real model on Saudi phrasings", () => {
  it("understands each phrasing as the call needs", async () => {
    const misses: string[] = [];
    let finished = 0;
    for (const [target, heard, expected] of SAUDI_CASES) {
      if (spent() >= BUDGET) break;
      const raw = await choose(target, heard);
      const final = raw ? outcome(target, raw.name, raw.args, heard) : "ask";
      const pass = final.includes(expected) || (expected === "ask" && final === "ask");
      if (!pass) misses.push(`[${target}] «${heard}» → ${raw?.name} ${JSON.stringify(raw?.args)} → ${final} (want ${expected})`);
      finished += 1;
      if (process.env.NAQAH_REAL_MODEL_LOG) appendFileSync(process.env.NAQAH_REAL_MODEL_LOG, JSON.stringify({ target, heard, expected, raw, final, pass, spent: spent() }) + "\n");
    }
    expect(finished).toBe(SAUDI_CASES.length);
    expect(misses).toEqual([]);
  }, 600_000);
});
