/**
 * The bridge's turn rules (services/voice-bridge/server.mjs), for a browser connection: one response
 * at a time, tools in order, the worker talking over audible replies only, dropped calls answered,
 * and every word the agent says chosen by the server. Kept apart from React so it can be tested
 * against provider events.
 */
import { verbatimSpeechInstructions } from "../../../services/voice-bridge/speech.mjs";

export type ProviderEvent = Record<string, unknown> & { type: string };

export interface ToolReply {
  output: string;
  end: null | "hangup" | "fallback";
  goodbye: string | null;
  /** Spoken word for word. Only this counts as the worker having heard the summary. */
  summaryText?: string;
  summaryId?: string;
  /** Spoken word for word. */
  sayText?: string;
  /** Say nothing, unless the current prompt was cut off. */
  silent?: true;
  repromptText?: string;
}

/** What a tool call knows about the worker's turn, reported as the bridge reports it. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  spoke: boolean;
  workerUtterance?: string;
  heardSummaryId?: string;
}

interface WorkerTurn {
  id: string | null;
  heardSummaryId?: string;
  settled: boolean;
  transcript: string;
  settle(transcript: string): void;
  promise: Promise<string>;
}

interface SummaryPlayback { heard: boolean; cancelled: boolean; id?: string; text: string; transcripts: Map<string, string>; responseId?: string }
interface Prompt { kind: Kind; text: string; summaryId?: string; repromptText: string | null; played: boolean; cutOff: boolean }
type NextResponse = { kind: Kind; text?: string; summaryId?: string; repromptText?: string; prompt?: Prompt };

export interface LoopHost {
  send(event: object): void;
  runTool(call: ToolCall): Promise<ToolReply>;
  log(kind: string, detail?: string): void;
  interrupted(cut: { responseId: string | null; itemId: string | null }): void;
  usage(usage: unknown): void;
  fail(code: string, detail?: string): void;
  finished(reason: string): void;
}

type Kind = "opening" | "turn" | "question" | "summary" | "reprompt" | "goodbye";

const RESPONSE_MS = 45_000;
const GOODBYE_MS = 15_000;
const REPROMPT_MS = 10_000;
const MAX_REPROMPTS = 2;
const SPEECH_MS = 10_000;
const TRANSCRIPTION_MS = 2_500;
const SPEECH_COMMIT_MS = 5_000;
const MAX_TOOLS = 128;
const HARMLESS = new Set(["response_cancel_not_active", "conversation_already_has_active_response"]);

const TRUNCATE = "lab-truncate-";
const CONTROL = /[\u0000-\u001f\u007f]/u;
const CLARIFYING = new Set(["noise", "facts_not_supported", "worker_has_not_answered", "answer_conflicts_with_words", "number_not_in_answer", "answer_off_topic", "answer_unclear", "summary_not_finished", "worker_has_not_confirmed"]);

/** A refusal that recorded nothing and sends the agent back to the worker, as opposed to a bad tool call. */
export const asksToClarify = (refused: string | null) => refused !== null && CLARIFYING.has(refused);

/** Spelling a transcript may vary never counts as a changed summary. The bridge's own comparison. */
const summaryWords = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\p{M}/gu, "").replace(/[أإآٱ]/gu, "ا").replace(/ى/gu, "ي").replace(/ة/gu, "ه")
  .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

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
  private nextResponse: NextResponse | null = null;
  private ignored = new Set<string>();
  private toolIds = new Set<string>();
  private toolQueue: Promise<void> = Promise.resolve();
  private toolPending = 0;
  private audio: { itemId: string; contentIndex: number; startedAt: number; responseId: string | null } | null = null;
  private lastItem: { itemId: string; contentIndex: number } | null = null;
  private goodbyeHeard = false;
  private workerTurn: WorkerTurn | null = null;
  private speechEpoch = 0;
  private turnHeardSummaryId: string | undefined;
  private recoveryCommit: string | null = null;
  private responseSummary: SummaryPlayback | null = null;
  private summaryPlayback: SummaryPlayback | null = null;
  /** The summary finished generating; it counts as heard once its audio has played out. */
  private summaryPlaying: SummaryPlayback | null = null;
  private lastPrompt: Prompt | null = null;
  private responsePrompt: Prompt | null = null;
  /** The prompt finished generating; it counts as played once its audio has. */
  private promptPlaying: { prompt: Prompt; responseId: string } | null = null;
  private reprompts = 0;
  private lastStopped: string | null = null;
  private truncates = 0;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private host: LoopHost, private mode: "voice" | "text", private opening: string, private openingReprompt?: string) {}

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

  /** Once a prompt has played and nothing is pending, a quiet worker hears it again, then the call stops. Typing takes as long as it takes. */
  private activity() {
    this.clearTimer("silence");
    if (this.mode !== "voice" || this.closed || this.ending || !this.lastPrompt?.played || this.speaking || this.toolPending || this.responsePending || this.responseId || this.nextResponse || this.userSpoke) return;
    this.timer("silence", REPROMPT_MS, () => {
      const prompt = this.lastPrompt!;
      if (this.reprompts >= MAX_REPROMPTS || !prompt.repromptText?.trim()) return this.finish("silence_timeout");
      this.reprompts += 1;
      this.host.log("reprompt", String(this.reprompts));
      this.requestResponse("reprompt", prompt.repromptText, { prompt });
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

  private newTurn(id: string | null, heardSummaryId: string | undefined): WorkerTurn {
    const turn = { id, heardSummaryId, settled: false, transcript: "" } as WorkerTurn;
    turn.promise = new Promise((resolve) => {
      turn.settle = (transcript) => {
        if (turn.settled) return;
        turn.settled = true;
        turn.transcript = transcript;
        resolve(transcript);
      };
    });
    return turn;
  }

  sendText(text: string): void {
    if (this.closed || this.ending || !this.ready) return;
    this.interrupt();
    // Typed text is already final, so it is its own transcript.
    this.speechEpoch += 1;
    this.workerTurn?.settle("");
    this.reprompts = 0;
    this.workerTurn = this.newTurn(null, this.summaryPlayback?.heard ? this.summaryPlayback.id : undefined);
    this.workerTurn.settle(text);
    this.host.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    this.userSpoke = true;
    this.requestResponse("turn");
  }

  private requestResponse(kind: Kind, text?: string, options: Omit<NextResponse, "kind" | "text"> = {}) {
    this.nextResponse = { kind, text, ...options };
    this.activity();
    this.flushResponse();
  }

  private flushResponse() {
    if (this.closed || !this.ready || this.responsePending || this.responseId || this.toolPending || this.speaking || !this.nextResponse) return;
    const next = this.nextResponse;
    this.nextResponse = null;
    this.responsePending = true;
    this.responseKind = next.kind;
    this.responseAudible = false;
    this.responsePrompt = null;
    if (next.text && next.kind !== "goodbye") {
      this.responsePrompt = next.prompt ?? { kind: next.kind, text: next.text, summaryId: next.summaryId, repromptText: next.repromptText ?? (next.kind === "summary" ? null : next.text), played: false, cutOff: false };
      this.lastPrompt = this.responsePrompt;
      this.responsePrompt.played = false;
      this.responsePrompt.cutOff = false;
    }
    this.responseSummary = next.kind === "summary" && next.text && !(next.prompt && this.summaryPlayback?.heard)
      ? { heard: false, cancelled: false, id: next.summaryId ?? next.prompt?.summaryId, text: next.text, transcripts: new Map() } : null;
    if (this.responseSummary) this.summaryPlayback = this.responseSummary;
    this.activity();
    const response: Record<string, unknown> = { output_modalities: [this.mode === "voice" ? "audio" : "text"] };
    if (next.text) {
      response.instructions = verbatimSpeechInstructions(next.text);
      response.tool_choice = "none";
    }
    this.host.send({ type: "response.create", response });
    this.timer("response", RESPONSE_MS, () => this.fail("response_timeout"));
  }

  /** Only a reply the worker can hear is cut off; one still being prepared goes ahead. */
  interrupt(): void {
    if (this.closed || (!this.responseAudible && !this.audio)) return;
    if (this.lastPrompt && !this.lastPrompt.played) this.lastPrompt.cutOff = true;
    if (this.summaryPlayback && !this.summaryPlayback.heard) this.summaryPlayback.cancelled = true;
    if (this.mode === "voice") this.host.send({ type: "output_audio_buffer.clear" });
    if (this.responseId && this.responseAudible) {
      this.ignored.add(this.responseId);
      if (!this.cancelSent) this.host.send({ type: "response.cancel", response_id: this.responseId });
      this.cancelSent = true;
    }
    if (this.audio) {
      this.host.send({ type: "conversation.item.truncate", event_id: `${TRUNCATE}${++this.truncates}`, item_id: this.audio.itemId, content_index: this.audio.contentIndex, audio_end_ms: Math.max(0, Date.now() - this.audio.startedAt) });
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
        if (this.recoveryCommit && error?.event_id === this.recoveryCommit) return this.fail("speech_recovery_failed", code);
        // The browser can only estimate how much was heard, so an overshoot is not a failure.
        const overshoot = typeof error?.event_id === "string" && error.event_id.startsWith(TRUNCATE);
        if (HARMLESS.has(code) || overshoot) return this.host.log("provider_note", code);
        return this.fail("provider_error", code);
      }
      case "session.created":
        if (this.ready) return;
        this.ready = true;
        this.host.log("session_ready");
        this.activity();
        return this.requestResponse("opening", this.opening, { repromptText: this.openingReprompt });
      case "response.created": {
        const id = asRecord(event.response)?.id;
        if (this.responseId || !this.responsePending || typeof id !== "string") return this.fail("provider_invalid", "unexpected_response");
        this.responsePending = false;
        this.responseId = id;
        if (this.responseSummary) this.responseSummary.responseId = id;
        return;
      }
      case "response.output_item.added": {
        const item = asRecord(event.item);
        if (item?.type === "message" && typeof item.id === "string") this.lastItem = { itemId: item.id, contentIndex: 0 };
        return;
      }
      // Per response, as the bridge counts it: an earlier reply's audio says nothing about this one,
      // and a reply already cut off stays cut off.
      case "response.output_audio_transcript.delta":
        if (event.response_id === this.responseId && !this.ignored.has(event.response_id as string)) this.responseAudible = true;
        return this.activity();
      case "output_audio_buffer.started":
        if (event.response_id !== this.responseId || this.ignored.has(event.response_id as string)) return;
        this.responseAudible = true;
        if (this.lastItem) this.audio = { ...this.lastItem, startedAt: Date.now(), responseId: this.responseId };
        return this.activity();
      case "output_audio_buffer.stopped": {
        if (this.audio && this.audio.responseId === event.response_id) this.audio = null;
        this.lastStopped = typeof event.response_id === "string" ? event.response_id : null;
        const playing = this.summaryPlaying;
        if (playing && playing.responseId === event.response_id) {
          if (!playing.cancelled) playing.heard = true;
          this.summaryPlaying = null;
        }
        const sounding = this.promptPlaying;
        if (sounding && sounding.responseId === event.response_id) {
          this.promptPlaying = null;
          if (this.lastPrompt === sounding.prompt && !sounding.prompt.cutOff) sounding.prompt.played = true;
        }
        if (this.ending && this.goodbyeHeard) return this.finish("goodbye_played");
        return this.activity();
      }
      case "output_audio_buffer.cleared":
        this.audio = null;
        this.summaryPlaying = null;
        this.promptPlaying = null;
        if (this.ending && this.goodbyeHeard) return this.finish("goodbye_played");
        return this.activity();
      case "response.output_text.delta":
        if (event.response_id === this.responseId && !this.ignored.has(event.response_id as string)) this.responseAudible = true;
        return;
      case "response.output_audio_transcript.done":
      case "response.output_text.done": {
        const words = event.type.endsWith("transcript.done") ? event.transcript : event.text;
        const reading = this.responseSummary;
        if (reading && reading.responseId === event.response_id && typeof words === "string" && typeof event.item_id === "string") reading.transcripts.set(event.item_id, words);
        return;
      }
      case "input_audio_buffer.speech_started":
        if (this.ending) return;
        this.reprompts = 0;
        if (!this.speaking) {
          this.speechEpoch += 1;
          this.turnHeardSummaryId = this.summaryPlayback?.heard ? this.summaryPlayback.id : undefined;
          this.timer("speech", SPEECH_MS, () => {
            if (!this.speaking || this.ending) return;
            this.recoveryCommit = `speech-recovery-${this.speechEpoch}`;
            this.host.log("speech_recovery_commit");
            this.host.send({ type: "input_audio_buffer.commit", event_id: this.recoveryCommit });
            this.timer("speech_commit", SPEECH_COMMIT_MS, () => this.fail("speech_recovery_timeout"));
          });
        }
        this.speaking = true;
        this.activity();
        this.earlySpeech = this.responseKind === "opening" && Boolean(this.responsePending || this.responseId) && !this.responseAudible && !this.audio;
        return this.interrupt();
      case "input_audio_buffer.speech_stopped":
        // The reply waits for the commit, so it can't start without the worker's words.
        this.speaking = false;
        this.clearTimer("speech");
        return this.activity();
      case "input_audio_buffer.committed":
        if (this.ending) return;
        this.clearTimer("speech");
        this.clearTimer("speech_commit");
        this.recoveryCommit = null;
        this.speaking = false;
        this.reprompts = 0;
        this.workerTurn?.settle("");
        this.workerTurn = this.newTurn(typeof event.item_id === "string" ? event.item_id : null, this.turnHeardSummaryId);
        this.turnHeardSummaryId = undefined;
        this.activity();
        if (this.earlySpeech) {
          this.earlySpeech = false;
          if (this.responsePending || this.responseId) return this.host.log("speech_during_opening");
        }
        this.userSpoke = true;
        return this.requestResponse("turn");
      case "conversation.item.input_audio_transcription.completed":
      case "conversation.item.input_audio_transcription.failed": {
        const turn = this.workerTurn;
        if (!turn?.id || event.item_id !== turn.id || event.content_index !== 0) return;
        const text = event.transcript;
        turn.settle(event.type.endsWith(".completed") && typeof text === "string" && text.length <= 1000 && !CONTROL.test(text) ? text : "");
        return;
      }
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
    if (id !== this.responseId) return this.fail("provider_invalid", "unexpected_completion");
    const interrupted = id ? this.ignored.delete(id) : false;
    const status = response?.status;
    if (status !== "completed" && !(interrupted && status === "cancelled")) {
      const details = asRecord(response?.status_details);
      const error = asRecord(details?.error);
      return this.fail("response_failed", String(error?.code ?? details?.reason ?? status ?? "unknown"));
    }
    const kind = this.responseKind;
    const prompt = this.responsePrompt;
    if (prompt && !interrupted && this.responseAudible && !prompt.cutOff) {
      if (this.mode === "text" || this.lastStopped === id) prompt.played = true;
      else if (id) this.promptPlaying = { prompt, responseId: id };
    }
    this.responsePrompt = null;
    const summary = this.responseSummary;
    // Only a summary spoken as written counts as heard: a model reply could say anything.
    const asWritten = summary !== null && summary.transcripts.size > 0 && summaryWords([...summary.transcripts.values()].join(" ")) === summaryWords(summary.text);
    if (summary && asWritten && !interrupted && this.responseAudible && !summary.cancelled) {
      // Text is read as it arrives. Audio still has to finish playing, unless it already has.
      if (this.mode === "text" || this.lastStopped === id) summary.heard = true;
      else this.summaryPlaying = summary;
    }
    this.responseSummary = null;
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
    this.activity();
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
    this.activity();
    const turn = this.workerTurn;
    const epoch = this.speechEpoch;
    const spoke = this.userSpoke;
    this.toolQueue = this.toolQueue
      .then(async () => {
        if (this.closed || this.ending) return;
        // Every tool is checked against the worker's words, so it waits for them.
        if (spoke && turn && !turn.settled) {
          this.timer("transcription", TRANSCRIPTION_MS, () => turn.settle(""));
          await turn.promise;
          this.clearTimer("transcription");
        }
        if (this.closed) return;
        const current = this.workerTurn === turn && this.speechEpoch === epoch && !this.speaking;
        const result = await this.host.runTool({
          name,
          args: input,
          spoke: spoke && this.userSpoke && current,
          workerUtterance: current ? turn?.transcript ?? "" : "",
          ...(current && turn?.heardSummaryId !== undefined ? { heardSummaryId: turn.heardSummaryId } : {}),
        });
        if (this.closed) return;
        const summary = result.summaryText?.trim() ? result.summaryText : null;
        const question = result.sayText?.trim() ? result.sayText : null;
        const actions = [result.summaryText, result.sayText, result.silent].filter((value) => value !== undefined);
        if (!result.end && (actions.length !== 1 || (!summary && !question && result.silent !== true))) return this.fail("tool_failed", "invalid_result");
        if (this.workerTurn === turn) {
          this.userSpoke = false;
          turn?.settle("");
          if (turn) turn.transcript = "";
        }
        // Only a summary the server speaks word for word counts as heard.
        if (summary) this.summaryPlayback = null;
        this.host.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: result.output } });
        if (result.end) {
          this.ending = true;
          this.clearTimer("silence");
          this.nextResponse = null;
          if (!result.goodbye?.trim()) return this.finish("tool_ended");
          this.speaking = false;
          this.timer("goodbye", GOODBYE_MS, () => this.finish("goodbye_timeout"));
          this.requestResponse("goodbye", result.goodbye);
        } else if (summary) {
          this.requestResponse("summary", summary, { summaryId: result.summaryId, repromptText: result.repromptText });
        } else if (question) {
          this.requestResponse("question", question, { repromptText: result.repromptText });
        } else {
          this.host.log("tool_silent");
          if (this.lastPrompt?.cutOff) this.requestResponse(this.lastPrompt.kind, this.lastPrompt.text, { prompt: this.lastPrompt });
        }
      })
      .catch((error: unknown) => this.fail("tool_failed", error instanceof Error ? error.message : undefined))
      .finally(() => {
        this.toolPending -= 1;
        this.flushResponse();
        this.activity();
      });
  }
}
