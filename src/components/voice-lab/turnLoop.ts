/**
 * The bridge's turn rules (services/voice-bridge/server.mjs), for a browser connection: one response
 * at a time, tools in order, the worker talking over audible replies only, dropped calls answered.
 * Kept apart from React so it can be tested against provider events.
 */
export type ProviderEvent = Record<string, unknown> & { type: string };

export interface ToolReply {
  output: string;
  end: null | "hangup";
  goodbye: string | null;
}

export interface LoopHost {
  send(event: object): void;
  runTool(call: { name: string; args: Record<string, unknown>; spoke: boolean }): Promise<ToolReply>;
  log(kind: string, detail?: string): void;
  interrupted(cut: { responseId: string | null; itemId: string | null }): void;
  usage(usage: unknown): void;
  fail(code: string, detail?: string): void;
  finished(reason: string): void;
}

type Kind = "opening" | "turn" | "goodbye";

const RESPONSE_MS = 45_000;
const GOODBYE_MS = 15_000;
const SILENCE_MS = 45_000;
const MAX_TOOLS = 128;
const HARMLESS = new Set(["response_cancel_not_active", "conversation_already_has_active_response"]);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export class TurnLoop {
  private ready = false;
  private closed = false;
  private ending = false;
  private speaking = false;
  private userSpoke = false;
  private earlySpeech = false;
  private responsePending = false;
  private responseId: string | null = null;
  private responseKind: Kind | null = null;
  private responseAudible = false;
  private cancelSent = false;
  private nextResponse: { kind: Kind; text?: string } | null = null;
  private ignored = new Set<string>();
  private toolIds = new Set<string>();
  private toolQueue: Promise<void> = Promise.resolve();
  private toolPending = 0;
  private audio: { itemId: string; contentIndex: number; startedAt: number } | null = null;
  private lastItem: { itemId: string; contentIndex: number } | null = null;
  private goodbyeHeard = false;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private host: LoopHost, private mode: "voice" | "text", private opening: string) {}

  /** Something is playing or showing right now. A reply still being prepared can't be cut off. */
  get canInterrupt(): boolean {
    return this.responseAudible || Boolean(this.audio);
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** A reply is on its way or being heard, so there is something to interrupt. */
  get busy(): boolean {
    return Boolean(this.responsePending || this.responseId || this.audio);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private timer(name: string, ms: number, run: () => void) {
    this.clearTimer(name);
    this.timers.set(name, setTimeout(run, ms));
  }

  private clearTimer(name: string) {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
  }

  /** A quiet phone call hangs up after this long; the Lab does the same when talking. */
  private activity() {
    if (this.mode !== "voice" || this.closed || this.ending) return;
    this.timer("silence", SILENCE_MS, () => {
      if (this.speaking || this.audio) this.activity();
      else this.finish("silence_timeout");
    });
  }

  private fail(code: string, detail?: string) {
    if (this.closed) return;
    this.close();
    this.host.fail(code, detail);
  }

  private finish(reason: string) {
    if (this.closed) return;
    this.close();
    this.host.finished(reason);
  }

  sendText(text: string): void {
    if (this.closed || this.ending || !this.ready) return;
    this.interrupt();
    this.host.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    this.userSpoke = true;
    this.requestResponse("turn");
  }

  private requestResponse(kind: Kind, text?: string) {
    this.nextResponse = { kind, text };
    this.flushResponse();
  }

  private flushResponse() {
    if (this.closed || !this.ready || this.responsePending || this.responseId || this.toolPending || this.speaking || !this.nextResponse) return;
    const next = this.nextResponse;
    this.nextResponse = null;
    this.responsePending = true;
    this.responseKind = next.kind;
    this.responseAudible = false;
    const response: Record<string, unknown> = { output_modalities: [this.mode === "voice" ? "audio" : "text"] };
    if (next.text) {
      response.instructions = `Say only the following text verbatim, with no additions: ${JSON.stringify(next.text)}`;
      response.tool_choice = "none";
    }
    this.host.send({ type: "response.create", response });
    this.timer("response", RESPONSE_MS, () => this.fail("response_timeout"));
  }

  /** Only a reply the worker can hear is cut off; one still being prepared goes ahead. */
  interrupt(): void {
    if (this.closed || (!this.responseAudible && !this.audio)) return;
    if (this.mode === "voice") this.host.send({ type: "output_audio_buffer.clear" });
    if (this.responseId && this.responseAudible) {
      this.ignored.add(this.responseId);
      if (!this.cancelSent) this.host.send({ type: "response.cancel", response_id: this.responseId });
      this.cancelSent = true;
    }
    if (this.audio) {
      this.host.send({ type: "conversation.item.truncate", item_id: this.audio.itemId, content_index: this.audio.contentIndex, audio_end_ms: Math.max(0, Date.now() - this.audio.startedAt) });
    }
    const cut = { responseId: this.responseId, itemId: this.audio?.itemId ?? null };
    this.audio = null;
    this.responseAudible = false;
    this.host.interrupted(cut);
    this.host.log("barge_in");
  }

  handle(event: ProviderEvent): void {
    if (this.closed) return;
    switch (event.type) {
      case "error": {
        const error = asRecord(event.error);
        const code = typeof error?.code === "string" ? error.code : "provider_error";
        if (HARMLESS.has(code)) return this.host.log("provider_note", code);
        return this.fail("provider_error", code);
      }
      case "session.created":
        if (this.ready) return;
        this.ready = true;
        this.host.log("session_ready");
        this.activity();
        return this.requestResponse("opening", this.opening);
      case "response.created": {
        this.responsePending = false;
        this.responseId = typeof asRecord(event.response)?.id === "string" ? (asRecord(event.response)!.id as string) : null;
        return;
      }
      case "response.output_item.added": {
        const item = asRecord(event.item);
        if (item?.type === "message" && typeof item.id === "string") this.lastItem = { itemId: item.id, contentIndex: 0 };
        return;
      }
      case "output_audio_buffer.started":
        this.responseAudible = true;
        if (this.lastItem) this.audio = { ...this.lastItem, startedAt: Date.now() };
        return this.activity();
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.audio = null;
        if (this.ending && this.goodbyeHeard) return this.finish("goodbye_played");
        return this.activity();
      case "response.output_text.delta":
        this.responseAudible = true;
        return;
      case "input_audio_buffer.speech_started":
        if (this.ending) return;
        this.speaking = true;
        this.activity();
        this.earlySpeech = this.responseKind === "opening" && Boolean(this.responsePending || this.responseId) && !this.responseAudible && !this.audio;
        return this.interrupt();
      case "input_audio_buffer.speech_stopped":
        // The reply waits for the commit, so it can't start without the worker's words.
        this.speaking = false;
        return this.activity();
      case "input_audio_buffer.committed":
        if (this.ending) return;
        this.speaking = false;
        this.activity();
        if (this.earlySpeech) {
          this.earlySpeech = false;
          if (this.responsePending || this.responseId) return this.host.log("speech_during_opening");
        }
        this.userSpoke = true;
        return this.requestResponse("turn");
      case "response.function_call_arguments.done":
        if (!this.ending && !this.ignored.has(event.response_id as string)) this.queueTool(event);
        return;
      case "response.done":
        return this.responseDone(event);
    }
  }

  private responseDone(event: ProviderEvent) {
    const response = asRecord(event.response);
    this.host.usage(response?.usage);
    this.activity();
    const id = typeof response?.id === "string" ? response.id : null;
    const interrupted = id ? this.ignored.delete(id) : false;
    const status = response?.status;
    if (status !== "completed" && !(interrupted && status === "cancelled")) {
      const details = asRecord(response?.status_details);
      const error = asRecord(details?.error);
      return this.fail("response_failed", String(error?.code ?? details?.reason ?? status ?? "unknown"));
    }
    const kind = this.responseKind;
    this.responseId = null;
    this.responsePending = false;
    this.responseAudible = false;
    this.cancelSent = false;
    this.clearTimer("response");
    if (this.answerDroppedCalls(response?.output) && !this.nextResponse && !this.speaking && !this.ending) this.requestResponse("turn");
    if (kind === "goodbye") {
      this.goodbyeHeard = true;
      if (this.mode === "text" || !this.audio) this.finish("goodbye_played");
    } else {
      this.flushResponse();
    }
  }

  /** A cancel can lose the race. The call then sits unanswered and the model waits forever. */
  private answerDroppedCalls(output: unknown): boolean {
    if (this.ending || !Array.isArray(output)) return false;
    const dropped = output.map(asRecord).filter((item) => item?.type === "function_call" && item.status === "completed" && typeof item.call_id === "string" && !this.toolIds.has(item.call_id as string));
    for (const item of dropped) {
      this.toolIds.add(item!.call_id as string);
      this.host.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: item!.call_id, output: JSON.stringify({ status: "not_applied", error: "worker_interrupted", message: "The worker spoke over this and it was not recorded. Listen to what they said and call the tool again." }) },
      });
      this.host.log("tool_dropped_after_interrupt");
    }
    return dropped.length > 0;
  }

  private queueTool(event: ProviderEvent) {
    const callId = event.call_id;
    if (typeof callId !== "string" || !callId || typeof event.name !== "string" || typeof event.arguments !== "string") return this.fail("tool_invalid");
    if (this.toolIds.has(callId)) return;
    if (this.toolIds.size >= MAX_TOOLS) return this.fail("tool_limit");
    let args: Record<string, unknown> | null = null;
    try {
      args = asRecord(JSON.parse(event.arguments));
    } catch {
      args = null;
    }
    if (!args) return this.fail("tool_invalid");
    const name = event.name;
    const input = args;
    this.toolIds.add(callId);
    this.toolPending += 1;
    this.toolQueue = this.toolQueue
      .then(async () => {
        if (this.closed || this.ending) return;
        const result = await this.host.runTool({ name, args: input, spoke: this.userSpoke });
        if (this.closed) return;
        this.userSpoke = false;
        this.host.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: result.output } });
        if (result.end) {
          this.ending = true;
          this.clearTimer("silence");
          this.nextResponse = null;
          if (!result.goodbye?.trim()) return this.finish("tool_ended");
          this.speaking = false;
          this.timer("goodbye", GOODBYE_MS, () => this.finish("goodbye_timeout"));
          this.requestResponse("goodbye", result.goodbye);
        } else {
          this.requestResponse("turn");
        }
      })
      .catch((error: unknown) => this.fail("tool_failed", error instanceof Error ? error.message : undefined))
      .finally(() => {
        this.toolPending -= 1;
        this.flushResponse();
      });
  }
}
