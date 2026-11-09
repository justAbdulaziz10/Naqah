import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asksToClarify, TurnLoop, type LoopHost, type ToolReply } from "./turnLoop";
import { addResponseUsage, estimateUsd, NO_USAGE } from "./usage";

type Sent = Record<string, unknown> & { type: string };
const OK: ToolReply = { output: '{"status":"ok"}', end: null, goodbye: null };

function setup(mode: "voice" | "text" = "voice", reply: ToolReply = OK) {
  const sent: Sent[] = [];
  const host = {
    send: vi.fn((event: object) => { sent.push(event as Sent); }),
    runTool: vi.fn<LoopHost["runTool"]>(async () => reply),
    log: vi.fn(),
    interrupted: vi.fn(),
    usage: vi.fn(),
    fail: vi.fn(),
    finished: vi.fn(),
  } satisfies LoopHost;
  const loop = new TurnLoop(host, mode, "hello");
  const types = () => sent.map((event) => event.type);
  // Stands in for the request a turn makes, so a test can start at the provider's reply.
  const respond = (id: string) => {
    Object.assign(loop, { responsePending: true });
    loop.handle({ type: "response.created", response: { id } });
  };
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
    loop.handle({ type: "output_audio_buffer.started", response_id: "r1" });
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
    expect(host.runTool.mock.calls[0][0]).toMatchObject({ name: "confirm_report", spoke: false, workerUtterance: "" });
    loop.sendText("إيه احفظه");
    respond("r2");
    loop.handle({ type: "response.function_call_arguments.done", response_id: "r2", call_id: "c2", name: "confirm_report", arguments: '{"confirmed":true}' });
    done("r2");
    await flush();
    expect(host.runTool.mock.calls[1][0]).toMatchObject({ name: "confirm_report", spoke: true, workerUtterance: "إيه احفظه" });
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
    await vi.advanceTimersByTimeAsync(40_000);
    loop.handle({ type: "input_audio_buffer.speech_started" });
    await vi.advanceTimersByTimeAsync(9_000);
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
    loop.handle({ type: "output_audio_buffer.started", response_id: "r1" });
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

describe("confirming a summary", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const SUMMARY: ToolReply = { output: "{}", end: null, goodbye: null, summaryText: "هذا الملخص" };
  const confirmCall = (id: string, call: string) => ({ type: "response.function_call_arguments.done", response_id: id, call_id: call, name: "confirm_report", arguments: '{"confirmed":true}' });

  /** Gets to the agent reading the summary, with the audio started. */
  async function reading(mode: "voice" | "text" = "voice") {
    const kit = setup(mode, SUMMARY);
    kit.open();
    kit.respond("r1");
    kit.loop.handle({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c0", name: "answer_question", arguments: "{}" });
    kit.done("r1");
    await flush();
    kit.host.runTool.mockClear();
    kit.respond("r2");
    if (mode === "voice") {
      kit.loop.handle({ type: "response.output_item.added", item: { type: "message", id: "sum" } });
      kit.loop.handle({ type: "output_audio_buffer.started", response_id: "r2" });
    } else {
      kit.loop.handle({ type: "response.output_text.delta", item_id: "sum", response_id: "r2", delta: "ملخص" });
    }
    return kit;
  }

  async function speakAndConfirm(kit: Awaited<ReturnType<typeof reading>>, transcript: string | null, id = "r3") {
    kit.loop.handle({ type: "input_audio_buffer.speech_started" });
    kit.loop.handle({ type: "input_audio_buffer.speech_stopped" });
    kit.loop.handle({ type: "input_audio_buffer.committed", item_id: "w1" });
    kit.respond(id);
    kit.loop.handle(confirmCall(id, `c-${id}`));
    kit.done(id);
    if (transcript !== null) kit.loop.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "w1", content_index: 0, transcript });
    await flush();
  }

  it("counts a summary as heard only after its audio has played to the end", async () => {
    const kit = await reading();
    kit.done("r2");
    kit.loop.handle({ type: "output_audio_buffer.stopped", response_id: "r2" });
    await speakAndConfirm(kit, "إيه احفظه");
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ spoke: true, workerUtterance: "إيه احفظه", heardSummary: true });
  });

  it("counts a summary whose audio ended before the reply was marked done", async () => {
    const kit = await reading();
    kit.loop.handle({ type: "output_audio_buffer.stopped", response_id: "r2" });
    kit.done("r2");
    await speakAndConfirm(kit, "إيه احفظه");
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ heardSummary: true });
  });

  it("ignores an estimate of heard audio that overshoots", async () => {
    const kit = await reading();
    kit.loop.handle({ type: "input_audio_buffer.speech_started" });
    const truncate = kit.sent.find((event) => event.type === "conversation.item.truncate")!;
    kit.loop.handle({ type: "error", error: { code: "invalid_value", event_id: truncate.event_id } });
    expect(kit.host.fail).not.toHaveBeenCalled();
  });

  it("does not revive a reply cut off when more of its transcript arrives", async () => {
    const kit = await reading();
    kit.loop.handle({ type: "input_audio_buffer.speech_started" });
    kit.loop.handle({ type: "output_audio_buffer.cleared" });
    kit.loop.handle({ type: "response.output_audio_transcript.delta", response_id: "r2", item_id: "sum", delta: "…" });
    expect(kit.loop.canInterrupt).toBe(false);
  });

  async function spokenAnswer() {
    const kit = setup();
    kit.open();
    kit.loop.handle({ type: "input_audio_buffer.speech_started" });
    kit.loop.handle({ type: "input_audio_buffer.speech_stopped" });
    kit.loop.handle({ type: "input_audio_buffer.committed", item_id: "w1" });
    kit.respond("r1");
    kit.loop.handle({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c1", name: "answer_question", arguments: '{"value":"yes"}' });
    kit.done("r1");
    await flush();
    return kit;
  }

  it("holds a spoken answer until the worker's final words can be checked", async () => {
    const kit = await spokenAnswer();
    expect(kit.host.runTool).not.toHaveBeenCalled();
    kit.loop.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "w1", content_index: 0, transcript: "العلف زين" });
    await flush();
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ spoke: true, heard: "العلف زين" });
  });

  it("reports a failed transcript as empty, not as nothing to check", async () => {
    const kit = await spokenAnswer();
    kit.loop.handle({ type: "conversation.item.input_audio_transcription.failed", item_id: "w1", content_index: 0 });
    await flush();
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ spoke: true, heard: "" });
  });

  it("stops waiting for a transcript that never comes", async () => {
    const kit = await spokenAnswer();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ spoke: true, heard: "" });
  });

  it("gives a typed answer its own words at once", async () => {
    const kit = setup("text");
    kit.open();
    kit.loop.sendText("العلف زين");
    kit.respond("r1");
    kit.loop.handle({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c1", name: "answer_question", arguments: '{"value":"yes"}' });
    kit.done("r1");
    await flush();
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ spoke: true, heard: "العلف زين" });
  });

  it("shows an off-topic answer as asking again, not as a failed check", () => {
    expect(asksToClarify("answer_off_topic")).toBe(true);
    expect(asksToClarify("answer_unclear")).toBe(true);
    expect(asksToClarify("value_not_allowed")).toBe(false);
    expect(asksToClarify(null)).toBe(false);
  });

  it("speaks the summary word for word with tools off", async () => {
    const kit = await reading();
    const request = kit.sent.filter((event) => event.type === "response.create").at(-1)!.response as { tool_choice: string; instructions: string };
    expect(request.tool_choice).toBe("none");
    expect(request.instructions).toContain("هذا الملخص");
  });

  it("does not count a model's own reply as the summary", async () => {
    const kit = setup("voice", OK);
    kit.open();
    kit.respond("r1");
    kit.loop.handle({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c0", name: "answer_question", arguments: "{}" });
    kit.done("r1");
    await flush();
    kit.host.runTool.mockClear();
    kit.respond("r2");
    kit.loop.handle({ type: "response.output_item.added", item: { type: "message", id: "sum" } });
    kit.loop.handle({ type: "output_audio_buffer.started", response_id: "r2" });
    kit.done("r2");
    kit.loop.handle({ type: "output_audio_buffer.stopped", response_id: "r2" });
    await speakAndConfirm(kit, "إيه احفظه");
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ heardSummary: false });
  });

  it("does not let an earlier reply's audio ending count as hearing the summary", async () => {
    const kit = await reading();
    kit.done("r2");
    kit.loop.handle({ type: "output_audio_buffer.stopped", response_id: "r1" });
    await speakAndConfirm(kit, "إيه احفظه");
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ heardSummary: false });
  });

  it("treats a summary as audible from its own transcript, with no new buffer start", async () => {
    const kit = await reading();
    kit.done("r2");
    kit.loop.handle({ type: "output_audio_buffer.stopped", response_id: "r2" });
    kit.host.runTool.mockClear();
    const next = setup("voice", SUMMARY);
    next.open();
    next.respond("r1");
    next.loop.handle({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c0", name: "answer_question", arguments: "{}" });
    next.done("r1");
    await flush();
    next.respond("r2");
    next.loop.handle({ type: "response.output_item.added", item: { type: "message", id: "sum" } });
    next.loop.handle({ type: "response.output_audio_transcript.delta", response_id: "r2", item_id: "sum", delta: "ملخص" });
    expect(next.loop.canInterrupt).toBe(true);
  });

  it("does not count a summary still playing when the worker talks over it", async () => {
    const kit = await reading();
    kit.done("r2");
    await speakAndConfirm(kit, "إيه احفظه");
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ heardSummary: false });
  });

  it("does not count a summary cut off while it was being generated", async () => {
    const kit = await reading();
    kit.loop.handle({ type: "input_audio_buffer.speech_started" });
    kit.done("r2", "cancelled");
    kit.loop.handle({ type: "output_audio_buffer.cleared" });
    kit.loop.handle({ type: "input_audio_buffer.speech_stopped" });
    kit.loop.handle({ type: "input_audio_buffer.committed", item_id: "w1" });
    kit.respond("r3");
    kit.loop.handle(confirmCall("r3", "c3"));
    kit.done("r3");
    kit.loop.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "w1", content_index: 0, transcript: "إيه احفظه" });
    await flush();
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ heardSummary: false });
  });

  it("does not count a typed interruption of the summary", async () => {
    const kit = await reading("text");
    kit.loop.sendText("إيه احفظه");
    kit.done("r2", "cancelled");
    kit.respond("r3");
    kit.loop.handle(confirmCall("r3", "c3"));
    kit.done("r3");
    await flush();
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ workerUtterance: "إيه احفظه", heardSummary: false });
  });

  it("counts a text summary that finished, then a typed confirmation", async () => {
    const kit = await reading("text");
    kit.done("r2");
    kit.loop.sendText("إيه احفظه");
    kit.respond("r3");
    kit.loop.handle(confirmCall("r3", "c3"));
    kit.done("r3");
    await flush();
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ spoke: true, workerUtterance: "إيه احفظه", heardSummary: true });
  });

  it("waits for the final transcript, and sends none if it never comes", async () => {
    const kit = await reading();
    kit.done("r2");
    kit.loop.handle({ type: "output_audio_buffer.stopped", response_id: "r2" });
    await speakAndConfirm(kit, null);
    expect(kit.host.runTool).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ workerUtterance: "" });
  });

  it("treats a failed transcription as no transcript", async () => {
    const kit = await reading();
    kit.done("r2");
    kit.loop.handle({ type: "output_audio_buffer.stopped", response_id: "r2" });
    kit.loop.handle({ type: "input_audio_buffer.speech_started" });
    kit.loop.handle({ type: "input_audio_buffer.speech_stopped" });
    kit.loop.handle({ type: "input_audio_buffer.committed", item_id: "w1" });
    kit.respond("r3");
    kit.loop.handle(confirmCall("r3", "c3"));
    kit.done("r3");
    kit.loop.handle({ type: "conversation.item.input_audio_transcription.failed", item_id: "w1", content_index: 0 });
    await flush();
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ workerUtterance: "" });
  });

  it("drops the evidence when the worker starts talking again before the check", async () => {
    const kit = await reading();
    kit.done("r2");
    kit.loop.handle({ type: "output_audio_buffer.stopped", response_id: "r2" });
    kit.loop.handle({ type: "input_audio_buffer.speech_started" });
    kit.loop.handle({ type: "input_audio_buffer.speech_stopped" });
    kit.loop.handle({ type: "input_audio_buffer.committed", item_id: "w1" });
    kit.respond("r3");
    kit.loop.handle(confirmCall("r3", "c3"));
    kit.done("r3");
    kit.loop.handle({ type: "input_audio_buffer.speech_started" });
    kit.loop.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "w1", content_index: 0, transcript: "إيه احفظه" });
    await flush();
    expect(kit.host.runTool.mock.calls[0][0]).toMatchObject({ spoke: false, workerUtterance: "", heardSummary: false });
  });

  it("forces a commit when speech runs on, as the bridge does", async () => {
    const { loop, types, open } = setup();
    open();
    loop.handle({ type: "input_audio_buffer.speech_started" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(types()).toContain("input_audio_buffer.commit");
  });

  it("stops on a completion that doesn't match the reply in progress", () => {
    const { loop, host, respond, open } = setup();
    open();
    respond("r1");
    loop.handle({ type: "response.done", response: { id: "other", status: "completed" } });
    expect(host.fail).toHaveBeenCalledWith("provider_invalid", "unexpected_completion");
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
