import { createHmac, timingSafeEqual } from "node:crypto";
import type { AnswerInput, Scenario } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";

export interface VoiceState {
  v: 1;
  sc: Extract<Scenario, "worker_report" | "owner_inquiry">;
  l: Locale;
  t: number;
  callSid?: string;
  a: AnswerInput[];
}

export const VOICE_STATE_MAX_AGE_MS = 30 * 60 * 1000;
export const VOICE_MISS_VALUE = "__naqah_miss__";
const MAX_ANSWERS = 45;
const MAX_INPUT_LENGTH = 300;

function validAnswer(value: unknown): value is AnswerInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const answer = value as Record<string, unknown>;
  const keys = Object.keys(answer);
  if (keys.some((key) => key !== "value" && key !== "text")) return false;
  if ("value" in answer && typeof answer.value !== "string") return false;
  if ("text" in answer && typeof answer.text !== "string") return false;
  return keys.length > 0 && keys.every((key) => (answer[key] as string).length <= MAX_INPUT_LENGTH);
}

export function isVoiceMiss(input: AnswerInput): boolean {
  return input.value === VOICE_MISS_VALUE;
}

export function signVoiceState(state: VoiceState, secret = process.env.NAQAH_VOICE_SECRET): string {
  if (!secret) throw new Error("NAQAH_VOICE_SECRET is required to sign voice state");
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyVoiceState(
  token: string | null | undefined,
  secret = process.env.NAQAH_VOICE_SECRET,
  now = Date.now(),
): VoiceState | null {
  if (!token || !secret || token.length > 20_000) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<VoiceState>;
    if (
      state.v !== 1 ||
      (state.sc !== "worker_report" && state.sc !== "owner_inquiry") ||
      (state.l !== "ar" && state.l !== "en") ||
      !Number.isSafeInteger(state.t) ||
      (state.callSid !== undefined && (typeof state.callSid !== "string" || state.callSid.length > 128)) ||
      !Array.isArray(state.a) ||
      state.a.length > MAX_ANSWERS ||
      !state.a.every(validAnswer)
    ) {
      return null;
    }
    if (now - state.t! > VOICE_STATE_MAX_AGE_MS || state.t! > now + 60_000) return null;
    return state as VoiceState;
  } catch {
    return null;
  }
}
