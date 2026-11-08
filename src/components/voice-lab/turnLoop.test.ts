import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnLoop, type LoopHost, type ToolReply } from "./turnLoop";
import { addResponseUsage, estimateUsd, NO_USAGE } from "./usage";

type Sent = Record<string, unknown> & { type: string };
const OK: ToolReply = { output: '{"status":"ok"}', end: null, goodbye: null };

function setup(mode: "voice" | "text" = "voice", reply: ToolReply = OK) {
  const sent: Sent[] = [];
  const host = {
    send: vi.fn((event: object) => { sent.push(event as Sent); }),
    runTool: vi.fn(async () => reply),
    log: vi.fn(),
    interrupted: vi.fn(),
    usage: vi.fn(),
    fail: vi.fn(),
    finished: vi.fn(),
  } satisfies LoopHost;
  const loop = new TurnLoop(host, mode, "hello");
  const types = () => sent.map((event) => event.type);
  const respond = (id: string) => loop.handle({ type: "response.created", response: { id } });
  const done = (id: string, status = "completed", output: unknown[] = []) => loop.handle({ type: "response.done", response: { id, status, output } });
  const open = () => { loop.handle({ type: "session.created" }); respond("r0"); done("r0"); sent.length = 0; };
  return { loop, host, sent, types, respond, done, open };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("TurnLoop", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("speaks the opening verbatim with tools off", () => {
    const { loop, sent } = setup();
    loop.handle({ type: "session.created" });
    const response = sent[0].response as { tool_choice: string; instructions: string };
    expect(sent[0].type).toBe("response.create");
    expect(response.tool_choice).toBe("none");
    expect(response.instructions).toContain("hello");
  });

  it("replies once per committed turn, and holds a second until the first ends", () => {
    const { loop, types, respond, done, open } = setup();
    open();
    loop.handle({ type: "input_audio_buffer.committed" });
    respond("r1");
    loop.handle({ type: "input_audio_buffer.committed" });
    expect(types()).toEqual(["response.create"]);
    done("r1");
    expect(types()).toEqual(["response.create", "response.create"]);
  });

  it("cuts off a reply being heard: clear, cancel and truncate", () => {
    const { loop, host, types, respond, open } = setup();
    open();
    loop.handle({ type: "input_audio_buffer.committed" });
    respond("r1");
    loop.handle({ type: "response.output_item.added", item: { type: "message", id: "item1" } });
    loop.handle({ type: "output_audio_buffer.started" });
    loop.handle({ type: "input_audio_buffer.speech_started" });
    expect(types()).toEqual(["response.create", "output_audio_buffer.clear", "response.cancel", "conversation.item.truncate"]);
    expect(host.interrupted).toHaveBeenCalledWith({ responseId: "r1", itemId: "item1" });
  });

  it("does not cancel a reply that nobody can hear yet", () => {
    const { loop, types, respond, open } = setup();
    open();
    loop.handle({ type: "input_audio_buffer.committed" });
    respond("r1");
    expect(loop.canInterrupt).toBe(false);
    loop.handle({ type: "input_audio_buffer.speech_started" });
    expect(types()).toEqual(["response.create"]);
  });

  it("marks whether the worker spoke, so a model can't confirm by itself", async () => {
    const { loop, host, respond, done, open } = setup();
    open();
    respond("r1");
    loop.handle({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c1", name: "confirm_report", arguments: '{"confirmed":true}' });
    done("r1");
    await flush();
    expect(host.runTool.mock.calls[0]).toEqual([{ name: "confirm_report", args: { confirmed: true }, spoke: false }]);
    loop.sendText("إيه احفظه");
    respond("r2");
    loop.handle({ type: "response.function_call_arguments.done", response_id: "r2", call_id: "c2", name: "confirm_report", arguments: '{"confirmed":true}' });
    done("r2");
    await flush();
    expect(host.runTool.mock.calls[1]).toEqual([{ name: "confirm_report", args: { confirmed: true }, spoke: true }]);
  });

  it("waits for the commit before replying to speech that stopped", async () => {
    const { loop, types, respond, done, open } = setup();
    open();
    respond("r1");
    loop.handle({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c1", name: "answer_question", arguments: "{}" });
    loop.handle({ type: "input_audio_buffer.speech_started" });
    done("r1");
    await flush();
    loop.handle({ type: "input_audio_buffer.speech_stopped" });
    expect(types().filter((type) => type === "response.create")).toHaveLength(0);
    loop.handle({ type: "input_audio_buffer.committed" });
    expect(types().filter((type) => type === "response.create")).toHaveLength(1);
  });

  it("hangs up a silent voice call, as the phone does, but not while the worker talks", async () => {
    const { loop, host, open } = setup();
    open();
    loop.handle({ type: "input_audio_buffer.speech_started" });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(host.finished).not.toHaveBeenCalled();
    loop.handle({ type: "input_audio_buffer.speech_stopped" });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(host.finished).toHaveBeenCalledWith("silence_timeout");
  });

  it("runs a repeated tool call only once", async () => {
    const { loop, host, respond, done, open } = setup();
    open();
    respond("r1");
    const call = { type: "response.function_call_arguments.done", response_id: "r1", call_id: "c1", name: "answer_question", arguments: "{}" };
    loop.handle(call);
    loop.handle(call);
    done("r1");
    await flush();
    expect(host.runTool).toHaveBeenCalledTimes(1);
  });

  it("answers a call dropped by an interruption instead of leaving the model waiting", () => {
    const { loop, host, sent, respond, done, open } = setup();
    open();
    loop.handle({ type: "input_audio_buffer.committed" });
    respond("r1");
    loop.handle({ type: "output_audio_buffer.started" });
    loop.handle({ type: "input_audio_buffer.speech_started" });
    loop.handle({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c1", name: "answer_question", arguments: "{}" });
    done("r1", "completed", [{ type: "function_call", status: "completed", call_id: "c1" }]);
    expect(host.runTool).not.toHaveBeenCalled();
    expect(JSON.stringify(sent.find((event) => event.type === "conversation.item.create"))).toContain("worker_interrupted");
  });

  it("says goodbye and finishes when a tool ends the call", async () => {
    const { loop, host, sent, respond, done, open } = setup("text", { output: "{}", end: "hangup", goodbye: "مع السلامة" });
    open();
    respond("r1");
    loop.handle({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c1", name: "confirm_report", arguments: "{}" });
    done("r1");
    await flush();
    expect(JSON.stringify(sent.at(-1))).toContain("مع السلامة");
    respond("r2");
    done("r2");
    expect(host.finished).toHaveBeenCalledWith("goodbye_played");
  });

  it("stops on a failed reply and reports why", () => {
    const { loop, host, respond, open } = setup();
    open();
    respond("r1");
    loop.handle({ type: "response.done", response: { id: "r1", status: "failed", status_details: { error: { code: "insufficient_quota" } } } });
    expect(host.fail).toHaveBeenCalledWith("response_failed", "insufficient_quota");
  });

  it("ignores harmless provider races", () => {
    const { loop, host, open } = setup();
    open();
    loop.handle({ type: "error", error: { code: "response_cancel_not_active" } });
    expect(host.fail).not.toHaveBeenCalled();
  });

  it("times out a reply that never comes", async () => {
    const { loop, host, open } = setup("text");
    open();
    loop.sendText("هلا");
    await vi.advanceTimersByTimeAsync(45_000);
    expect(host.fail).toHaveBeenCalledWith("response_timeout", undefined);
  });
});

describe("usage", () => {
  it("bills cached tokens at their own rate", () => {
    const usage = addResponseUsage(NO_USAGE, { input_token_details: { text_tokens: 1000, audio_tokens: 500, cached_tokens_details: { text_tokens: 400, audio_tokens: 100 } }, output_token_details: { text_tokens: 100, audio_tokens: 200 } });
    expect(usage).toMatchObject({ textInput: 600, textCached: 400, audioInput: 400, audioCached: 100, textOutput: 100, audioOutput: 200 });
    const price = { textInput: 4, textCached: 0.4, textOutput: 24, audioInput: 32, audioCached: 0.4, audioOutput: 64, transcribeInput: 1.25, transcribeOutput: 5 };
    expect(estimateUsd(usage, price)).toBeCloseTo((600 * 4 + 400 * 0.4 + 400 * 32 + 100 * 0.4 + 100 * 24 + 200 * 64) / 1_000_000, 8);
  });
});
