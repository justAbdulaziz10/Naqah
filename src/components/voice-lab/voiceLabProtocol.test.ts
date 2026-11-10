import { describe, expect, it } from "vitest";
import { parseProviderEvent, parseVoiceLabResponse } from "./voiceLabProtocol";

const view = {
  step: "report_question",
  done: false,
  isSummary: false,
  mode: "guided",
  queue: ["Water level"],
  answered: 0,
  question: "How is the water?",
  summary: null,
  facts: [{ id: "water", group: "said", label: "Water", value: "Enough", certainty: "reported" }],
  notReported: [],
  findings: [],
  contract: { valid: true },
  verdict: null,
};

describe("voice lab API response parser", () => {
  it("accepts a complete status response and rejects malformed fields", () => {
    expect(parseVoiceLabResponse("status", {
      ok: true,
      model: "gpt-realtime-2.1",
      configured: true,
      source: "sample",
      ranch: "Al Wadi",
      worker: "Salem",
      queue: ["Water"],
    })).toMatchObject({ ok: true, operation: "status", status: { configured: true, queue: ["Water"] } });
    expect(parseVoiceLabResponse("status", { ok: true, model: "x", configured: "yes", source: "sample", ranch: "", worker: "", queue: [] })).toBeNull();
    expect(parseVoiceLabResponse("open", {
      ok: true,
      answer: "v=0",
      state: "state-token",
      closeState: "close-token",
      opening: "Hello",
      repromptText: "Hello",
      view: { ...view, answered: -1 },
      pricing: null,
      maxSeconds: 600,
    })).toBeNull();
  });

  it("parses validated open and tool payloads", () => {
    expect(parseVoiceLabResponse("open", {
      ok: true,
      answer: "v=0",
      state: "state-token",
      closeState: "close-token",
      opening: "Hello",
      repromptText: "Hello",
      view,
      pricing: null,
      maxSeconds: 600,
    })).toMatchObject({ ok: true, operation: "open", opened: { view: { step: "report_question" }, maxSeconds: 600 } });
    expect(parseVoiceLabResponse("tool", {
      ok: true,
      output: "{}",
      end: null,
      goodbye: null,
      state: "next-state",
      refused: null,
      sayText: "How is the water?",
      repromptText: "How is the water?",
      view,
    })).toMatchObject({ ok: true, operation: "tool", tool: { output: "{}", refused: null, sayText: "How is the water?" } });
    expect(parseVoiceLabResponse("tool", { ok: true, output: "{}", end: null, goodbye: null, state: "x", refused: null, view, silent: "yes" })).toBeNull();
    expect(parseVoiceLabResponse("open", { ok: true, answer: "v=0", state: "s", closeState: "c", opening: "Hello", repromptText: "Hello", view: { ...view, mode: "other" }, pricing: null, maxSeconds: 600 })).toBeNull();
    expect(parseVoiceLabResponse("tool", { ok: true, output: "{}", end: "continue", goodbye: null, state: "x", refused: null, view })).toBeNull();
  });

  it("preserves server errors and maps malformed bodies to no parsed response", () => {
    expect(parseVoiceLabResponse("open", { ok: false, error: "provider_failed", provider: "overloaded" })).toEqual({ ok: false, error: "provider_failed", provider: "overloaded" });
    expect(parseVoiceLabResponse("open", { ok: true, answer: "v=0" })).toBeNull();
  });
});

describe("voice lab provider event parser", () => {
  it("accepts handled events only after checking their required fields", () => {
    expect(parseProviderEvent({ type: "response.created", response: { id: "resp_1" } })).toEqual({ type: "response.created", response: { id: "resp_1" } });
    expect(parseProviderEvent({ type: "response.created", response: {} })).toBeNull();
    expect(parseProviderEvent({ type: "response.output_text.delta", response_id: "resp_1", item_id: "item_1", delta: "Hello" })).toEqual({ type: "response.output_text.delta", response_id: "resp_1", item_id: "item_1", delta: "Hello" });
    expect(parseProviderEvent({ type: "error" })).toBeNull();
    expect(parseProviderEvent({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "answer_question", arguments: "{}" })).toMatchObject({ type: "response.function_call_arguments.done", call_id: "call_1" });
    expect(parseProviderEvent({ type: "response.function_call_arguments.done", call_id: "call_1", name: "answer_question", arguments: {} })).toBeNull();
    expect(parseProviderEvent({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "answer_question", arguments: "{}" })).toMatchObject({ type: "response.function_call_arguments.done", response_id: "resp_1" });
    expect(parseProviderEvent({ type: "response.output_text.delta", response_id: "resp_1", delta: 2 })).toBeNull();
    expect(parseProviderEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", content_index: 0, transcript: "Water is low", usage: { input_tokens: -1 } })).toBeNull();
    expect(parseProviderEvent({ type: "response.done", response: { id: "resp_1", status: "completed", output: [null] } })).toBeNull();
  });

  it("accepts known ignored event names and rejects unknown or malformed events", () => {
    expect(parseProviderEvent({ type: "rate_limits.updated" })).toEqual({ type: "rate_limits.updated" });
    expect(parseProviderEvent({ type: "vendor.unexpected" })).toBeNull();
    expect(parseProviderEvent("not-json-object")).toBeNull();
  });
});
