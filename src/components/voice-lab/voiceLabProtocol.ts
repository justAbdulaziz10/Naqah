import type { LabPricing } from "./usage";

export type LabMode = "voice" | "text";
export type LabPhase = "idle" | "connecting" | "live" | "ended" | "failed";

export interface LabFact {
  id: string;
  group: "said" | "report";
  label: string;
  value: string;
  certainty: "reported" | "approximate" | "unknown" | "verified" | null;
}

export type LabVerdict =
  | { kind: "would_save" }
  | { kind: "would_reject"; reason: string }
  | { kind: "declined" }
  | { kind: "ended" }
  | { kind: "fallback" };

export interface LabView {
  step: string;
  done: boolean;
  isSummary: boolean;
  queue: string[];
  answered: number;
  question: string;
  summary: string | null;
  facts: LabFact[];
  findings: string[];
  contract: { valid: true } | { valid: false; field: string };
  verdict: LabVerdict | null;
}

export type TranscriptEntry =
  | { id: string; role: "worker" | "agent"; text: string; pending: boolean; interrupted?: boolean }
  | { id: string; role: "tool"; refused: string | null; name: string; clarifying: boolean; declined: boolean };

export interface InspectorEntry { id: number; at: number; kind: string; detail?: string; error?: boolean }
export interface LabError { code: string; detail?: string }

export interface LabStatus {
  model: string;
  configured: boolean;
  source: "farm" | "sample";
  ranch: string;
  worker: string;
  queue: string[];
}

export type LabAccess = "loading" | "ready" | "signed_out" | "private" | "error";

export interface LabOpenResponse {
  answer: string;
  state: string;
  closeState: string;
  opening: string;
  view: LabView;
  pricing: LabPricing | null;
  maxSeconds: number;
}

export interface LabToolResponse {
  output: string;
  end: null | "hangup" | "fallback";
  goodbye: string | null;
  summaryText?: string;
  state: string;
  refused: string | null;
  view: LabView;
}

export type VoiceLabApiFailure = { ok: false; error: string; provider?: string };
export type VoiceLabApiResponse =
  | VoiceLabApiFailure
  | { ok: true; operation: "status"; status: LabStatus }
  | { ok: true; operation: "open"; opened: LabOpenResponse }
  | { ok: true; operation: "tool"; tool: LabToolResponse }
  | { ok: true; operation: "close" };

export type VoiceLabOperation = "status" | "open" | "tool" | "close";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonnegativeNumber(value: unknown): value is number {
  return finiteNumber(value) && value >= 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function pricing(value: unknown): LabPricing | null {
  const data = record(value);
  if (!data) return null;
  const textInput = data.textInput;
  const textCached = data.textCached;
  const textOutput = data.textOutput;
  const audioInput = data.audioInput;
  const audioCached = data.audioCached;
  const audioOutput = data.audioOutput;
  const transcribeInput = data.transcribeInput;
  const transcribeOutput = data.transcribeOutput;
  if (!finiteNumber(textInput) || !finiteNumber(textCached) || !finiteNumber(textOutput) || !finiteNumber(audioInput) || !finiteNumber(audioCached) || !finiteNumber(audioOutput) || !finiteNumber(transcribeInput) || !finiteNumber(transcribeOutput)) return null;
  return {
    textInput,
    textCached,
    textOutput,
    audioInput,
    audioCached,
    audioOutput,
    transcribeInput,
    transcribeOutput,
  };
}

function labFact(value: unknown): LabFact | null {
  const data = record(value);
  if (!data || typeof data.id !== "string" || (data.group !== "said" && data.group !== "report") || typeof data.label !== "string" || typeof data.value !== "string") return null;
  const certainty = data.certainty;
  if (certainty !== null && certainty !== "reported" && certainty !== "approximate" && certainty !== "unknown" && certainty !== "verified") return null;
  return { id: data.id, group: data.group, label: data.label, value: data.value, certainty };
}

function labVerdict(value: unknown): LabVerdict | null | undefined {
  if (value === null) return null;
  const data = record(value);
  if (!data || typeof data.kind !== "string") return undefined;
  switch (data.kind) {
    case "would_save":
    case "declined":
    case "ended":
    case "fallback":
      return { kind: data.kind };
    case "would_reject":
      return typeof data.reason === "string" ? { kind: data.kind, reason: data.reason } : undefined;
    default:
      return undefined;
  }
}

function labView(value: unknown): LabView | null {
  const data = record(value);
  if (!data || typeof data.step !== "string" || typeof data.done !== "boolean" || typeof data.isSummary !== "boolean" || !stringArray(data.queue) || !Number.isSafeInteger(data.answered) || typeof data.answered !== "number" || data.answered < 0 || typeof data.question !== "string" || (data.summary !== null && typeof data.summary !== "string") || !Array.isArray(data.facts) || !stringArray(data.findings)) return null;
  const facts = data.facts.map(labFact);
  if (facts.some((fact) => fact === null)) return null;
  const contractData = record(data.contract);
  let contract: LabView["contract"];
  if (contractData?.valid === true) contract = { valid: true };
  else if (contractData?.valid === false && typeof contractData.field === "string") contract = { valid: false, field: contractData.field };
  else return null;
  const verdict = labVerdict(data.verdict);
  if (verdict === undefined) return null;
  return {
    step: data.step,
    done: data.done,
    isSummary: data.isSummary,
    queue: data.queue,
    answered: data.answered,
    question: data.question,
    summary: data.summary,
    facts: facts.filter((fact): fact is LabFact => fact !== null),
    findings: data.findings,
    contract,
    verdict,
  };
}

function apiFailure(data: UnknownRecord): VoiceLabApiFailure | null {
  if (data.ok !== false || typeof data.error !== "string") return null;
  if (data.provider !== undefined && typeof data.provider !== "string") return null;
  return { ok: false, error: data.error, ...(typeof data.provider === "string" ? { provider: data.provider } : {}) };
}

export function parseVoiceLabResponse(operation: VoiceLabOperation, value: unknown): VoiceLabApiResponse | null {
  const data = record(value);
  if (!data) return null;
  const failure = apiFailure(data);
  if (failure) return failure;
  if (data.ok !== true) return null;

  if (operation === "status") {
    if (typeof data.model !== "string" || typeof data.configured !== "boolean" || (data.source !== "farm" && data.source !== "sample") || typeof data.ranch !== "string" || typeof data.worker !== "string" || !stringArray(data.queue)) return null;
    return { ok: true, operation, status: { model: data.model, configured: data.configured, source: data.source, ranch: data.ranch, worker: data.worker, queue: data.queue } };
  }
  if (operation === "open") {
    const view = labView(data.view);
    const parsedPricing = data.pricing === null ? null : pricing(data.pricing);
    if (typeof data.answer !== "string" || typeof data.state !== "string" || typeof data.closeState !== "string" || typeof data.opening !== "string" || !view || (data.pricing !== null && !parsedPricing) || typeof data.maxSeconds !== "number" || !Number.isFinite(data.maxSeconds) || data.maxSeconds <= 0) return null;
    return { ok: true, operation, opened: { answer: data.answer, state: data.state, closeState: data.closeState, opening: data.opening, view, pricing: parsedPricing, maxSeconds: data.maxSeconds } };
  }
  if (operation === "tool") {
    const view = labView(data.view);
    if (typeof data.output !== "string" || (data.end !== null && data.end !== "hangup" && data.end !== "fallback") || (data.goodbye !== null && typeof data.goodbye !== "string") || (data.summaryText !== undefined && typeof data.summaryText !== "string") || typeof data.state !== "string" || (data.refused !== null && typeof data.refused !== "string") || !view) return null;
    return { ok: true, operation, tool: { output: data.output, end: data.end, goodbye: data.goodbye, ...(typeof data.summaryText === "string" ? { summaryText: data.summaryText } : {}), state: data.state, refused: data.refused, view } };
  }
  return { ok: true, operation: "close" };
}

export async function voiceLabRequest(
  operation: VoiceLabOperation,
  body: UnknownRecord,
  init: RequestInit = {},
): Promise<{ status: number; data: VoiceLabApiResponse | null }> {
  const response = await fetch("/api/voice-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
  const raw: unknown = await response.json().catch(() => null);
  return { status: response.status, data: parseVoiceLabResponse(operation, raw) };
}

export interface ProviderEvent extends UnknownRecord { type: string }

function usageData(value: unknown): UnknownRecord | null | undefined {
  if (value === undefined) return undefined;
  const data = record(value);
  if (!data) return null;
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
    if (data[key] !== undefined && !nonnegativeNumber(data[key])) return null;
  }
  for (const key of ["input_token_details", "output_token_details"]) {
    if (data[key] === undefined) continue;
    const details = record(data[key]);
    if (!details) return null;
    for (const tokenKey of ["text_tokens", "audio_tokens", "cached_tokens"]) {
      if (details[tokenKey] !== undefined && !nonnegativeNumber(details[tokenKey])) return null;
    }
    if (details.cached_tokens_details !== undefined) {
      const cached = record(details.cached_tokens_details);
      if (!cached || Object.values(cached).some((count) => !nonnegativeNumber(count))) return null;
    }
  }
  return data;
}

function responseOutput(value: unknown): UnknownRecord[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const output: UnknownRecord[] = [];
  for (const item of value) {
    const data = record(item);
    if (!data || (data.type !== undefined && typeof data.type !== "string") || (data.status !== undefined && typeof data.status !== "string") || (data.call_id !== undefined && typeof data.call_id !== "string")) return null;
    output.push(data);
  }
  return output;
}

const IGNORED_PROVIDER_TYPES = new Set([
  "session.updated", "rate_limits.updated", "conversation.item.created", "conversation.item.deleted", "conversation.item.truncated", "conversation.item.retrieved",
  "response.output_item.done", "response.content_part.added", "response.content_part.done", "response.audio.delta", "response.audio.done",
  "response.audio_transcript.delta", "response.audio_transcript.done", "response.output_audio.delta", "response.output_audio.done",
  "response.function_call_arguments.delta",
]);

export function parseProviderEvent(value: unknown): ProviderEvent | null {
  const data = record(value);
  if (!data || typeof data.type !== "string") return null;
  const type = data.type;
  switch (type) {
    case "session.created":
    case "output_audio_buffer.cleared":
    case "input_audio_buffer.speech_started":
    case "input_audio_buffer.speech_stopped":
      return { type };
    case "error": {
      const error = record(data.error);
      if (!error || (error.code !== undefined && typeof error.code !== "string") || (error.event_id !== undefined && typeof error.event_id !== "string")) return null;
      return { type, error: { ...(typeof error.code === "string" ? { code: error.code } : {}), ...(typeof error.event_id === "string" ? { event_id: error.event_id } : {}) } };
    }
    case "response.created": {
      const response = record(data.response);
      return response && typeof response.id === "string" ? { type, response: { id: response.id } } : null;
    }
    case "response.output_item.added": {
      const item = record(data.item);
      return item && typeof item.type === "string" && typeof item.id === "string" ? { type, item: { type: item.type, id: item.id } } : null;
    }
    case "response.output_audio_transcript.delta":
    case "response.output_text.delta":
      return typeof data.delta === "string" && typeof data.response_id === "string" && typeof data.item_id === "string"
        ? { type, response_id: data.response_id, item_id: data.item_id, delta: data.delta }
        : null;
    case "conversation.item.input_audio_transcription.delta":
      return typeof data.delta === "string" && typeof data.item_id === "string" ? { type, item_id: data.item_id, delta: data.delta } : null;
    case "response.output_audio_transcript.done":
      return typeof data.transcript === "string" && typeof data.item_id === "string"
        ? { type, transcript: data.transcript, item_id: data.item_id }
        : null;
    case "response.output_text.done":
      return typeof data.text === "string" && typeof data.item_id === "string"
        ? { type, text: data.text, item_id: data.item_id }
        : null;
    case "input_audio_buffer.committed":
      return data.item_id === undefined || typeof data.item_id === "string"
        ? { type, ...(typeof data.item_id === "string" ? { item_id: data.item_id } : {}) }
        : null;
    case "conversation.item.input_audio_transcription.completed":
    case "conversation.item.input_audio_transcription.failed": {
      const usage = usageData(data.usage);
      const error = record(data.error);
      if (typeof data.item_id !== "string" || !Number.isSafeInteger(data.content_index) || typeof data.content_index !== "number" || data.content_index < 0 || (data.transcript !== undefined && typeof data.transcript !== "string") || usage === null || (data.error !== undefined && (!error || (error.code !== undefined && typeof error.code !== "string")))) return null;
      return { type, item_id: data.item_id, content_index: data.content_index, ...(typeof data.transcript === "string" ? { transcript: data.transcript } : {}), ...(usage ? { usage } : {}), ...(error ? { error: { ...(typeof error.code === "string" ? { code: error.code } : {}) } } : {}) };
    }
    case "output_audio_buffer.started":
    case "output_audio_buffer.stopped":
      return typeof data.response_id === "string" ? { type, response_id: data.response_id } : null;
    case "response.function_call_arguments.done":
      return typeof data.response_id === "string" && typeof data.call_id === "string" && typeof data.name === "string" && typeof data.arguments === "string"
        ? { type, response_id: data.response_id, call_id: data.call_id, name: data.name, arguments: data.arguments }
        : null;
    case "response.done": {
      const response = record(data.response);
      const output = responseOutput(response?.output);
      const usage = usageData(response?.usage);
      if (!response || typeof response.id !== "string" || typeof response.status !== "string" || output === null || usage === null || (response.status_details !== undefined && response.status_details !== null && !record(response.status_details))) return null;
      return { type, response: { id: response.id, status: response.status, ...(output ? { output } : {}), ...(usage ? { usage } : {}), ...(record(response.status_details) ? { status_details: response.status_details } : {}) } };
    }
    default:
      return IGNORED_PROVIDER_TYPES.has(type) ? { ...data, type } : null;
  }
}
